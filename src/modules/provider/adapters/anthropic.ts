import { createHash } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metric, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";

const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
const OAUTH_USAGE_PATH = "/api/oauth/usage";
const OAUTH_CACHE_MS = 5 * 60 * 1000;

interface StoredAuth {
  anthropic?: {
    type?: string;
    access?: string;
    refresh?: string;
    apiKey?: string;
    key?: string;
    expires?: number;
  };
}

interface OAuthWindow {
  utilization?: number;
  resets_at?: string;
}

interface StructuredLimit {
  kind?: string;
  percent?: number;
  resets_at?: string;
  scope?: { model?: { display_name?: string; id?: string } };
}

interface OAuthUsageResponse {
  five_hour?: OAuthWindow | null;
  seven_day?: OAuthWindow | null;
  seven_day_sonnet?: OAuthWindow | null;
  seven_day_opus?: OAuthWindow | null;
  seven_day_oauth_apps?: OAuthWindow | null;
  limits?: StructuredLimit[];
  extra_usage?: {
    is_enabled?: boolean;
    monthly_limit?: number | null;
    used_credits?: number | null;
    utilization?: number | null;
  } | null;
}

type QuotaMetric = Extract<Metric, { kind: "quota-window" }>;

let oauthCache: { tokenHash: string; at: number; snapshot: UsageSnapshot } | undefined;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function resolveLocalAnthropicAuth(): Promise<{ token?: string; isOAuth: boolean; expires?: number }> {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    const raw = await readFile(authPath, "utf8");
    const anthropic = (JSON.parse(raw) as StoredAuth).anthropic;
    if (anthropic) {
      const isOAuth = anthropic.type === "oauth" || Boolean(anthropic.access);
      const token = anthropic.access || anthropic.apiKey || anthropic.key;
      return {
        ...(token ? { token } : {}),
        isOAuth,
        ...(anthropic.expires ? { expires: anthropic.expires } : {}),
      };
    }
  } catch {
    // Pi's resolved provider auth remains the primary source.
  }
  return { isOAuth: false };
}

function quotaMetric(id: string, label: string, utilization: unknown, resetAt?: string): QuotaMetric | undefined {
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return undefined;
  const used = Math.max(0, Math.min(100, utilization));
  const parsedReset = resetAt && Number.isFinite(Date.parse(resetAt)) ? new Date(resetAt).toISOString() : undefined;
  return {
    kind: "quota-window",
    id,
    label,
    remainingFraction: (100 - used) / 100,
    ...(parsedReset ? { resetAt: parsedReset } : {}),
  };
}

function parseOAuthMetrics(data: OAuthUsageResponse): Metric[] {
  const metrics: Metric[] = [];
  const flat = [
    quotaMetric("claude-5h", "Claude 5h", data.five_hour?.utilization, data.five_hour?.resets_at),
    quotaMetric("claude-7d", "Claude 7d", data.seven_day?.utilization, data.seven_day?.resets_at),
    quotaMetric("claude-7d-sonnet", "Claude 7d Sonnet", data.seven_day_sonnet?.utilization, data.seven_day_sonnet?.resets_at),
    quotaMetric("claude-7d-opus", "Claude 7d Opus", data.seven_day_opus?.utilization, data.seven_day_opus?.resets_at),
    quotaMetric("claude-7d-oauth", "Claude 7d OAuth", data.seven_day_oauth_apps?.utilization, data.seven_day_oauth_apps?.resets_at),
  ].filter((metric): metric is QuotaMetric => Boolean(metric));
  metrics.push(...flat);

  // Newer responses may move live limits into a self-describing array.
  if (Array.isArray(data.limits)) {
    for (const [index, limit] of data.limits.entries()) {
      const kind = (limit.kind ?? "").toLowerCase();
      const modelName = limit.scope?.model?.display_name || limit.scope?.model?.id;
      const id = kind === "session"
        ? "claude-session"
        : kind === "weekly_all"
          ? "claude-7d"
          : `claude-weekly-${modelName?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || index}`;
      if (metrics.some((metric) => metric.kind === "quota-window" && metric.id === id)) continue;
      const label = kind === "session"
        ? "Claude Session"
        : kind === "weekly_all"
          ? "Claude 7d"
          : modelName
            ? `Claude 7d ${modelName}`
            : "Claude Weekly";
      const metric = quotaMetric(id, label, limit.percent, limit.resets_at);
      if (metric) metrics.push(metric);
    }
  }

  const extra = data.extra_usage;
  if (extra?.is_enabled && typeof extra.utilization === "number") {
    const metric = quotaMetric("claude-extra-monthly", "Claude Extra Monthly", extra.utilization);
    if (metric) metrics.push(metric);
  }
  if (extra?.is_enabled && typeof extra.monthly_limit === "number" && typeof extra.used_credits === "number") {
    metrics.push({
      kind: "usage-limit",
      id: "claude-extra-credits",
      label: "Extra usage",
      used: extra.used_credits,
      limit: extra.monthly_limit,
      unit: "credits",
    });
  }

  return metrics;
}

function oauthSummary(metrics: Metric[]): string | undefined {
  const quotas = metrics.filter((metric): metric is QuotaMetric => metric.kind === "quota-window");
  const session = quotas.find((metric) => metric.id === "claude-5h" || metric.id === "claude-session");
  const weekly = quotas.find((metric) => metric.id === "claude-7d")
    ?? quotas.find((metric) => metric.id.startsWith("claude-7d-") || metric.id.startsWith("claude-weekly-"));
  const selected = [session, weekly].filter((metric): metric is QuotaMetric => Boolean(metric));
  if (!selected.length) return undefined;
  return `Claude · ${selected.map((metric) => `${metric.label.replace(/^Claude\s+/i, "")} ${Math.round(metric.remainingFraction * 100)}%`).join(" · ")}`;
}

export const anthropicAdapter: UsageAdapter = {
  id: "anthropic",
  label: "Anthropic Claude",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    if (target.baseUrl) {
      try {
        const origin = new URL(target.baseUrl).origin;
        if (origin === ANTHROPIC_API_ORIGIN) return true;
        if (pid === "anthropic" || pid === "claude") return false;
      } catch {
        return false;
      }
    }
    return pid === "anthropic" || pid === "claude";
  },

  async fetch({ target, signal, force, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const authRecord = target.auth?.auth as Record<string, unknown> | undefined;
    const local = await resolveLocalAnthropicAuth();
    const token = (authRecord?.apiKey ?? authRecord?.access ?? authRecord?.key) as string | undefined ?? local.token;
    const source = String(target.auth?.source ?? "").toLowerCase();
    const isOAuth = source.includes("oauth") || Boolean(authRecord?.access) || local.isOAuth;

    if (!token) {
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "Claude",
        state: "unauthorized",
        fetchedAt,
        accounts: [],
        error: "No API key or OAuth subscription found in Pi auth for Anthropic",
      };
    }

    try {
      if (isOAuth) {
        const hash = tokenHash(token);
        if (!force && oauthCache?.tokenHash === hash && Date.now() - oauthCache.at < OAUTH_CACHE_MS) {
          return oauthCache.snapshot;
        }

        const response = await sameOriginFetch(
          new URL(OAUTH_USAGE_PATH, ANTHROPIC_API_ORIGIN),
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "anthropic-version": "2023-06-01",
              "anthropic-beta": "oauth-2025-04-20",
              "User-Agent": "claude-cli (external, cli)",
              "x-app": "cli",
            },
            signal,
          },
          fetchFn,
          ANTHROPIC_API_ORIGIN,
        );

        if (response.status === 401 || response.status === 403) {
          return {
            adapterId: this.id,
            sourceProviderId: target.providerId,
            displayName: "Claude",
            state: "unauthorized",
            fetchedAt,
            accounts: [],
            error: `Anthropic OAuth usage returned HTTP ${response.status} (token may need refresh)`,
          };
        }
        if (!response.ok) throw new Error(`Anthropic OAuth usage returned HTTP ${response.status}`);

        const metrics = parseOAuthMetrics(await response.json() as OAuthUsageResponse);
        const summary = oauthSummary(metrics);
        const snapshot: UsageSnapshot = {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "Claude",
          state: metrics.length ? "ok" : "empty",
          fetchedAt,
          accounts: [{
            id: "claude-subscription",
            provider: "anthropic",
            label: "Claude Subscription",
            status: "available",
            metrics,
          }],
          ...(summary ? { summary } : { error: "Anthropic OAuth usage returned no recognized quota windows" }),
        };
        oauthCache = { tokenHash: hash, at: Date.now(), snapshot };
        return snapshot;
      }

      // API keys do not expose Pro/Max subscription windows. A minimal request
      // can only report the API key's instantaneous request/token rate limits.
      const response = await sameOriginFetch(
        new URL("/v1/messages", ANTHROPIC_API_ORIGIN),
        {
          method: "POST",
          headers: {
            "x-api-key": token,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: target.model?.id || "claude-sonnet-4-6",
            messages: [{ role: "user", content: "." }],
            max_tokens: 1,
          }),
          signal,
        },
        fetchFn,
        ANTHROPIC_API_ORIGIN,
      );

      if (response.status === 401 || response.status === 403) {
        return {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "Claude",
          state: "unauthorized",
          fetchedAt,
          accounts: [],
          error: `Anthropic returned HTTP ${response.status} (API key invalid)`,
        };
      }

      const metrics: Metric[] = [];
      const headerMetric = (id: string, label: string, remainingName: string, limitName: string, resetName: string): void => {
        const remaining = Number(response.headers.get(remainingName));
        const limit = Number(response.headers.get(limitName));
        if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0) return;
        const reset = response.headers.get(resetName);
        metrics.push({
          kind: "quota-window",
          id,
          label,
          remainingFraction: Math.max(0, Math.min(1, remaining / limit)),
          ...(reset && Number.isFinite(Date.parse(reset)) ? { resetAt: new Date(reset).toISOString() } : {}),
          detail: "API rate limit, not Claude subscription quota",
        });
      };
      headerMetric("claude-api-requests", "Claude API Requests", "anthropic-ratelimit-requests-remaining", "anthropic-ratelimit-requests-limit", "anthropic-ratelimit-requests-reset");
      headerMetric("claude-api-tokens", "Claude API Tokens", "anthropic-ratelimit-tokens-remaining", "anthropic-ratelimit-tokens-limit", "anthropic-ratelimit-tokens-reset");
      metrics.push({ kind: "status", id: "claude-plan", label: "Plan", value: "API Key" });

      const primary = metrics.find((metric): metric is QuotaMetric => metric.kind === "quota-window");
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "Claude",
        state: "ok",
        fetchedAt,
        summary: primary ? `Claude API · ${Math.round(primary.remainingFraction * 100)}% rate-limit headroom` : "Claude API · Active",
        accounts: [{
          id: "claude-api-key",
          provider: "anthropic",
          label: "Claude API Account",
          status: "available",
          metrics,
        }],
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};

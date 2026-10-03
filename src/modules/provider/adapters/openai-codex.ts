import type { Metric, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { isUrlOnDomain, safeError, sameOriginFetch } from "../../../core/security.ts";
import { compactQuotaSummary } from "../../../ui/format.ts";

const CODEX_BASE_ORIGIN = "https://chatgpt.com";
const CODEX_USAGE_PATH = "/backend-api/wham/usage";

interface WhamWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

interface WhamUsageResponse {
  user_id?: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  rate_limit?: WhamRateLimit | null;
  additional_rate_limits?: Array<{
    limit_name?: string;
    metered_feature?: string;
    rate_limit?: WhamRateLimit | null;
  }> | null;
}

interface WhamRateLimit {
  allowed?: boolean;
  limit_reached?: boolean;
  primary_window?: WhamWindow | null;
  secondary_window?: WhamWindow | null;
}

function windowLabel(window: WhamWindow): string {
  const seconds = window?.limit_window_seconds;
  if (seconds === 18_000) return "Codex 5h";
  if (seconds === 604_800) return "Codex 7d";
  if (typeof seconds === "number" && seconds > 0) {
    if (seconds % 86_400 === 0) return `Codex ${seconds / 86_400}d`;
    if (seconds % 3_600 === 0) return `Codex ${seconds / 3_600}h`;
  }
  return "Codex quota (window unknown)";
}

function parseWindow(
  window: WhamWindow | null | undefined,
  defaultId: string,
): Metric | undefined {
  if (!window || typeof window.used_percent !== "number" || !Number.isFinite(window.used_percent) || window.used_percent < 0 || window.used_percent > 100) return undefined;
  const remainingFraction = (100 - window.used_percent) / 100;

  let resetAt: string | undefined;
  if (typeof window.reset_at === "number" && window.reset_at > 0) {
    const time = new Date(window.reset_at * 1000);
    if (Number.isFinite(time.getTime())) resetAt = time.toISOString();
  } else if (typeof window.reset_after_seconds === "number" && window.reset_after_seconds > 0) {
    const time = new Date(Date.now() + window.reset_after_seconds * 1000);
    if (Number.isFinite(time.getTime())) resetAt = time.toISOString();
  }

  return {
    kind: "quota-window",
    id: defaultId,
    label: windowLabel(window),
    remainingFraction,
    ...(resetAt ? { resetAt } : {}),
  };
}

function accountIdFromToken(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
    };
    const id = payload["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export const openAICodexAdapter: UsageAdapter = {
  id: "openai-codex",
  label: "OpenAI Codex (ChatGPT)",
  canHandle(target) {
    if (target.providerId.toLowerCase() !== "openai-codex") return false;
    return !target.baseUrl || isUrlOnDomain(target.baseUrl, "chatgpt.com");
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    // Pi resolves and refreshes the OAuth credential. Never use a regular API key here.
    const isOAuth = String(target.auth?.source ?? "").toLowerCase() === "oauth";
    const accessToken = isOAuth ? target.auth?.auth.apiKey : undefined;
    const accountId = accessToken ? accountIdFromToken(accessToken) : undefined;

    if (!accessToken) {
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "OpenAI Codex",
        state: "unauthorized",
        fetchedAt,
        accounts: [],
        error: "No ChatGPT OAuth access token found for openai-codex",
      };
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      };
      if (accountId) {
        headers["ChatGPT-Account-Id"] = accountId;
      }

      const response = await sameOriginFetch(
        new URL(CODEX_USAGE_PATH, CODEX_BASE_ORIGIN),
        { method: "GET", headers, signal },
        fetchFn,
        CODEX_BASE_ORIGIN,
      );

      if (response.status === 401 || response.status === 403) {
        return {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "OpenAI Codex",
          state: "unauthorized",
          fetchedAt,
          accounts: [],
          error: `ChatGPT returned HTTP ${response.status} (token may need refresh)`,
        };
      }

      if (!response.ok) {
        throw new Error(`ChatGPT wham/usage returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as WhamUsageResponse;
      const metrics: Metric[] = [];

      const primary = parseWindow(data.rate_limit?.primary_window, "primary-window");
      if (primary) metrics.push(primary);

      const secondary = parseWindow(data.rate_limit?.secondary_window, "secondary-window");
      if (secondary) metrics.push(secondary);
      const ordinaryMetrics = metrics.length;

      const additional = Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : [];
      for (const [index, limit] of additional.entries()) {
        if (!limit || typeof limit !== "object") continue;
        const rawName = typeof limit.limit_name === "string" ? limit.limit_name : limit.metered_feature;
        const name = (typeof rawName === "string" ? rawName : `Additional ${index + 1}`)
          .replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 80) || `Additional ${index + 1}`;
        for (const [position, window] of [["primary", limit.rate_limit?.primary_window], ["secondary", limit.rate_limit?.secondary_window]] as const) {
          const metric = parseWindow(window, `additional-${index}-${position}`);
          if (metric) metrics.push({ ...metric, label: `${name} · ${metric.label.replace(/^Codex /, "")}` });
        }
      }

      const planLabel = data.plan_type ? `ChatGPT ${data.plan_type.toUpperCase()}` : "ChatGPT Plus/Pro";
      const accountLabel = data.email || data.user_id || planLabel;

      const accounts = [
        {
          id: data.account_id || accountId || data.user_id || "openai-codex-account",
          provider: "openai-codex",
          label: accountLabel,
          status: data.rate_limit?.limit_reached ? "limit_reached" : "available",
          metrics,
        },
      ];

      // Keep the footer focused on ordinary 5h/7d limits; additional model
      // limits remain available in /usage without masquerading as main quota.
      const summary = ordinaryMetrics
        ? compactQuotaSummary("Codex", metrics.slice(0, ordinaryMetrics))
        : compactQuotaSummary("Codex", metrics, 1);

      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "OpenAI Codex",
        state: metrics.length ? "ok" : "empty",
        fetchedAt,
        accounts,
        ...(summary ? { summary } : {}),
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: WhamWindow | null;
    secondary_window?: WhamWindow | null;
  } | null;
  credits?: {
    has_credits?: boolean;
    balance?: string;
  } | null;
}

function windowLabel(window: WhamWindow | null | undefined, fallback: string): string {
  const seconds = window?.limit_window_seconds;
  if (seconds === 18_000) return "Codex 5h";
  if (seconds === 604_800) return "Codex 7d";
  if (typeof seconds === "number" && seconds > 0) {
    if (seconds % 86_400 === 0) return `Codex ${seconds / 86_400}d`;
    if (seconds % 3_600 === 0) return `Codex ${seconds / 3_600}h`;
  }
  return fallback;
}

function parseWindow(
  window: WhamWindow | null | undefined,
  defaultId: string,
  defaultLabel: string,
): Metric | undefined {
  if (!window || typeof window.used_percent !== "number") return undefined;
  const used = Math.min(100, Math.max(0, window.used_percent));
  const remainingFraction = Math.max(0, (100 - used) / 100);

  let resetAt: string | undefined;
  if (typeof window.reset_at === "number" && window.reset_at > 0) {
    resetAt = new Date(window.reset_at * 1000).toISOString();
  } else if (typeof window.reset_after_seconds === "number" && window.reset_after_seconds > 0) {
    resetAt = new Date(Date.now() + window.reset_after_seconds * 1000).toISOString();
  }

  return {
    kind: "quota-window",
    id: defaultId,
    label: windowLabel(window, defaultLabel),
    remainingFraction,
    ...(resetAt ? { resetAt } : {}),
  };
}

async function resolveLocalCodexAuth(): Promise<{ accessToken?: string | undefined; accountId?: string | undefined }> {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    const raw = await readFile(authPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, { access?: string; apiKey?: string; accountId?: string; chatgpt_account_id?: string }>;
    const codex = parsed["openai-codex"];
    if (codex) {
      return {
        accessToken: codex.access ?? codex.apiKey,
        accountId: codex.accountId ?? codex.chatgpt_account_id,
      };
    }
  } catch {
    // Ignore fallback errors
  }
  return {};
}

export const openAICodexAdapter: UsageAdapter = {
  id: "openai-codex",
  label: "OpenAI Codex (ChatGPT)",
  canHandle(target) {
    const nativeId = target.providerId.toLowerCase() === "openai-codex";
    if (target.baseUrl) return isUrlOnDomain(target.baseUrl, "chatgpt.com");
    return nativeId;
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const authRecord = target.auth?.auth as Record<string, unknown> | undefined;
    let accessToken = (authRecord?.apiKey ?? authRecord?.access) as string | undefined;
    let accountId = (authRecord?.accountId ?? authRecord?.chatgpt_account_id) as string | undefined;

    if (!accessToken || !accountId) {
      const local = await resolveLocalCodexAuth();
      accessToken = accessToken ?? local.accessToken;
      accountId = accountId ?? local.accountId;
    }

    if (!accessToken) {
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "OpenAI Codex",
        state: "unauthorized",
        fetchedAt,
        accounts: [],
        error: "No access token found in Pi auth for openai-codex",
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

      const primary = parseWindow(data.rate_limit?.primary_window, "primary-window", "Codex 5h");
      if (primary) metrics.push(primary);

      const secondary = parseWindow(data.rate_limit?.secondary_window, "secondary-window", "Codex 7d");
      if (secondary) metrics.push(secondary);

      const planLabel = data.plan_type ? `ChatGPT ${data.plan_type.toUpperCase()}` : "ChatGPT Plus/Pro";
      const accountLabel = data.email || data.user_id || planLabel;

      const rawGroups = metrics.map((m) => {
        const qw = m as Extract<Metric, { kind: "quota-window" }>;
        return {
          id: qw.id,
          label: qw.label,
          remainingFraction: qw.remainingFraction,
          ...(qw.resetAt ? { resetTime: qw.resetAt } : {}),
          models: [{ id: qw.id }],
        };
      });

      const accounts = [
        {
          id: data.account_id || data.user_id || "openai-codex-account",
          provider: "openai-codex",
          label: accountLabel,
          status: data.rate_limit?.limit_reached ? "limit_reached" : "available",
          metrics,
          rawGroups,
        },
      ];

      const quotaMetrics = metrics.filter(
        (metric): metric is Extract<Metric, { kind: "quota-window" }> => metric.kind === "quota-window",
      );
      const summary = compactQuotaSummary("Codex", quotaMetrics);

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

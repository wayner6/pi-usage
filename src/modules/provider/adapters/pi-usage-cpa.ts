import type { Metric, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { isUrlOnDomain, safeError, sameOriginFetch, cpaUsageUrl } from "../../../core/security.ts";
import { isGroupRelevantToModels, type CpaGroup } from "../matching.ts";

const CPA_PROVIDERS = new Set(["antigravity", "claude", "codex", "kimi", "xai", "devin", "meta"]);

const NATIVE_PROVIDER_IDS = new Set([
  "deepseek", "openai-codex", "xai", "anthropic", "glm", "zai", "zai-coding-cn",
  "kimi-coding", "kimi-code", "kimi", "moonshot-code", "zhipu", "bigmodel",
  "siliconflow", "siliconflow-en", "siliconflow-cn", "openrouter", "opencode-go",
  "opencode", "google", "google-vertex",
]);

type CpaAccount = {
  provider?: string;
  authIndex?: string;
  label?: string;
  disabled?: boolean;
  unavailable?: boolean;
  error?: string;
  missingWindows?: string[];
  groups?: CpaGroup[];
};
type CpaUsage = {
  schemaVersion?: number;
  generatedAt?: string;
  cache?: { updatedAt?: string; stale?: boolean };
  accounts?: CpaAccount[];
};

export const piUsageCpaAdapter: UsageAdapter = {
  id: "pi-usage-cpa",
  label: "CLIProxyAPI / pi-usage-cpa",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    if (NATIVE_PROVIDER_IDS.has(pid)) return false;
    const baseUrl = target.auth?.auth.baseUrl ?? target.baseUrl;
    if (baseUrl) {
      try { new URL(baseUrl); } catch { return false; }
      const official = ["deepseek.com", "openai.com", "chatgpt.com", "anthropic.com", "x.ai", "bigmodel.cn", "siliconflow.cn", "siliconflow.com", "openrouter.ai", "opencode.ai", "googleapis.com", "kimi.com", "z.ai"];
      if (official.some((domain) => isUrlOnDomain(baseUrl, domain))) return false;
    }
    return pid.includes("cpa") || pid.includes("cliproxy") || pid.includes("proxy") || Boolean(baseUrl);
  },
  async fetch({ target, signal, force, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const apiKey = target.auth?.auth.apiKey;
    const baseUrl = target.auth?.auth.baseUrl ?? target.baseUrl;
    if (!baseUrl || !apiKey) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: target.providerId, state: "unauthorized", fetchedAt, accounts: [], error: "Missing base URL or API key" };
    try {
      const response = await sameOriginFetch(cpaUsageUrl(baseUrl, force), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "X-Pi-Contract": "2" },
        signal,
      }, fetchFn, new URL(baseUrl).origin);
      if (response.status === 404) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: target.providerId, state: "not-installed", fetchedAt, accounts: [], error: "pi-usage-cpa usage endpoint was not found" };
      if (response.status === 401 || response.status === 403) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: target.providerId, state: "unauthorized", fetchedAt, accounts: [], error: "The API key is not authorized for pi-usage-cpa" };
      if (!response.ok) throw new Error(`pi-usage-cpa returned HTTP ${response.status}`);
      const data = await response.json() as CpaUsage;
      if (data?.schemaVersion !== 1 || !Array.isArray(data.accounts) || data.accounts.some((account) =>
        !CPA_PROVIDERS.has(account?.provider ?? "") || !Array.isArray(account.groups) ||
        account.groups.some((group) => group?.modelGroup !== account.provider && !(account.provider === "antigravity" && ["gemini", "claude-gpt"].includes(group?.modelGroup ?? ""))) ||
        (!account.groups.some((group) => group?.source === "summary" || group?.source === "fallback") && !Array.isArray(account.missingWindows) && !account.error && !account.disabled && !account.unavailable)
      )) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: target.providerId, state: "incompatible", fetchedAt, accounts: [], error: "Unsupported pi-usage-cpa response schema" };
      const accounts = data.accounts.map((account, index) => {
        const groups = (Array.isArray(account.groups) ? account.groups : [])
          .filter((g) => g && typeof g.id === "string" && typeof g.label === "string" &&
            ((g.source === "summary" && (!g.window || ["5h", "7d", "daily", "monthly"].includes(g.window))) || (g.source === "fallback" && !g.window && account.provider === "antigravity")) &&
            typeof g.remainingFraction === "number" && Number.isFinite(g.remainingFraction) && g.remainingFraction >= 0 && g.remainingFraction <= 1)
          .filter((g) => isGroupRelevantToModels(g, target.configuredModelIds));
        const metrics: Metric[] = groups.map((g) => ({ kind: "quota-window", id: g.id, label: g.label, remainingFraction: g.remainingFraction, ...(g.resetTime ? { resetAt: g.resetTime } : {}) }));
        return {
          id: account.authIndex ?? `${account.provider}-${index}`, provider: account.provider!, label: account.label ?? `${account.provider} ${index + 1}`,
          ...(account.disabled !== undefined ? { disabled: account.disabled } : {}),
          ...(account.unavailable !== undefined ? { unavailable: account.unavailable } : {}),
          ...(account.error ? { error: account.error } : {}),
          ...(Array.isArray(account.missingWindows) ? { missingWindows: account.missingWindows } : {}),
          metrics, rawGroups: groups,
        };
      }).filter((account) => !target.configuredModelIds?.length || account.metrics.length > 0 || account.missingWindows?.length || account.error || account.disabled || account.unavailable);
      return {
        adapterId: this.id, sourceProviderId: target.providerId, displayName: target.providerId,
        state: accounts.length ? (data.cache?.stale ? "stale" : "ok") : "empty",
        fetchedAt: data.cache?.updatedAt ?? data.generatedAt ?? fetchedAt,
        ...(data.cache?.stale ? { stale: true } : {}), accounts,
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};

import type { Metric, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { bridgeUrl, safeError, sameOriginFetch } from "../../../core/security.ts";
import { isAccountRelevantToModels, isGroupRelevantToModels, deduplicateSharedQuotaGroups, friendlyGroupName } from "../matching.ts";

const NATIVE_PROVIDER_IDS = new Set([
  "deepseek",
  "openai-codex",
  "xai",
  "anthropic",
  "glm",
  "zai",
  "zai-coding-cn",
  "siliconflow",
  "siliconflow-en",
  "siliconflow-cn",
  "openrouter",
  "opencode-go",
  "opencode",
]);

type BridgeGroup = { id?: string; label?: string; remainingFraction?: number; resetTime?: string; models?: Array<{ id?: string; displayName?: string; remainingFraction?: number; resetTime?: string }> };
type BridgeAccount = { provider?: string; account?: string; authIndex?: string; label?: string; status?: string; disabled?: boolean; unavailable?: boolean; supported?: boolean; error?: string; groups?: BridgeGroup[] };
type BridgeUsage = { schemaVersion?: number; generatedAt?: string; cache?: { updatedAt?: string; stale?: boolean; ttlMs?: number }; accounts?: BridgeAccount[]; unsupportedProviders?: string[] };

function metrics(groups: BridgeGroup[]): Metric[] {
  return groups.flatMap((group, index) => {
    const base = group.remainingFraction;
    return typeof base === "number"
      ? [{ kind: "quota-window" as const, id: group.id ?? `quota-${index}`, label: group.label ?? group.id ?? "Quota", remainingFraction: Math.min(1, Math.max(0, base)), ...(group.resetTime ? { resetAt: group.resetTime } : {}) }]
      : [];
  });
}

export const cliProxyBridgeAdapter: UsageAdapter = {
  id: "cliproxy-pi-bridge",
  label: "CLIProxyAPI / pi-bridge",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    // Never hijack standard native providers unless explicitly configured as a bridge proxy
    if (NATIVE_PROVIDER_IDS.has(pid)) return false;

    // If explicit baseUrl exists, make sure it's not pointing to official provider APIs
    if (target.baseUrl) {
      try {
        const url = new URL(target.baseUrl);
        if (
          url.origin.includes("deepseek.com") ||
          url.origin.includes("openai.com") ||
          url.origin.includes("chatgpt.com") ||
          url.origin.includes("anthropic.com") ||
          url.origin.includes("x.ai") ||
          url.origin.includes("bigmodel.cn") ||
          url.origin.includes("siliconflow.cn") ||
          url.origin.includes("siliconflow.com") ||
          url.origin.includes("openrouter.ai") ||
          url.origin.includes("opencode.ai")
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }

    // Accept if providerId hints at proxy/bridge or if any custom non-native baseUrl is present
    return pid.includes("cpa") || pid.includes("cliproxy") || pid.includes("bridge") || pid.includes("proxy") || Boolean(target.baseUrl);
  },
  async fetch({ target, signal, force, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const apiKey = target.auth?.auth.apiKey;
    const baseUrl = target.auth?.auth.baseUrl ?? target.baseUrl;
    if (!baseUrl || !apiKey) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: target.providerId, state: "unauthorized", fetchedAt, accounts: [], error: "Missing base URL or API key" };
    const origin = new URL(baseUrl).origin;
    try {
      const response = await sameOriginFetch(bridgeUrl(baseUrl, "usage", force), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "X-Pi-Contract": "2" },
        signal,
      }, fetchFn, origin);
      if (response.status === 404) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: target.providerId, state: "not-installed", fetchedAt, accounts: [], error: "pi-bridge usage endpoint was not found" };
      if (response.status === 401 || response.status === 403) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: target.providerId, state: "unauthorized", fetchedAt, accounts: [], error: "The API key is not authorized for pi-bridge" };
      if (!response.ok) throw new Error(`pi-bridge returned HTTP ${response.status}`);
      const data = await response.json() as BridgeUsage;
      if (data.schemaVersion !== 1) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: target.providerId, state: "incompatible", fetchedAt, accounts: [], error: `Unsupported pi-bridge schemaVersion ${String(data.schemaVersion)}` };
      let accounts = (data.accounts ?? [])
        .map((account, index) => {
          let rawGroups = account.groups ?? [];

          // 1. Filter groups within this account if user configured specific models
          if (target.configuredModelIds && target.configuredModelIds.length > 0) {
            rawGroups = rawGroups.filter((g) => isGroupRelevantToModels(g, target.configuredModelIds));
          }

          // 2. Deduplicate shared quota pools (groups with identical remaining fraction and reset time)
          const deduplicatedGroups = deduplicateSharedQuotaGroups(rawGroups);
          const displayGroups = (account.provider ?? "").toLowerCase().includes("codex")
            ? deduplicatedGroups.map((group) => ({
                ...group,
                label: friendlyGroupName(group, undefined, account.provider),
              }))
            : deduplicatedGroups;

          return {
            id: account.authIndex ?? `${account.provider ?? "provider"}-${index}`,
            provider: account.provider ?? "unknown",
            label: account.label || account.account || account.provider || `Account ${index + 1}`,
            ...(account.status ? { status: account.status } : {}),
            ...(account.disabled !== undefined ? { disabled: account.disabled } : {}),
            ...(account.unavailable !== undefined ? { unavailable: account.unavailable } : {}),
            metrics: metrics(displayGroups),
            rawGroups: displayGroups,
            ...(account.error ? { error: account.error } : {}),
          };
        })
        // 3. Filter out accounts that have no relevant groups or aren't relevant to user models
        .filter((account) => {
          if (!target.configuredModelIds || target.configuredModelIds.length === 0) return true;
          return isAccountRelevantToModels(account, target.configuredModelIds) && account.metrics.length > 0;
        });

      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: target.providerId,
        state: accounts.length ? (data.cache?.stale ? "stale" : "ok") : "empty",
        fetchedAt: data.cache?.updatedAt ?? data.generatedAt ?? fetchedAt,
        ...(data.cache?.stale ? { stale: true } : {}),
        accounts,
        ...(data.unsupportedProviders?.length ? { diagnostic: `Unsupported upstream providers: ${data.unsupportedProviders.join(", ")}` } : {}),
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};

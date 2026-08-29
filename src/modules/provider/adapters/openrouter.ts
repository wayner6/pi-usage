import type { UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";

const OFFICIAL_ORIGIN = "https://openrouter.ai";

interface CreditsResponse {
  data?: {
    total_credits?: number;
    total_usage?: number;
    limit?: number | null;
  };
}

export const openRouterAdapter: UsageAdapter = {
  id: "openrouter",
  label: "OpenRouter",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    if (pid === "openrouter") return true;
    if (target.baseUrl) {
      try {
        const origin = new URL(target.baseUrl).origin;
        if (origin.includes("openrouter.ai")) return true;
      } catch { return false; }
    }
    return false;
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const apiKey = (target.auth?.auth as Record<string, unknown> | undefined)?.apiKey as string | undefined;
    if (!apiKey) {
      return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "OpenRouter", state: "unauthorized", fetchedAt, accounts: [], error: "No API key found in Pi auth for OpenRouter" };
    }
    try {
      const response = await sameOriginFetch(new URL("/api/v1/credits", OFFICIAL_ORIGIN), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal,
      }, fetchFn, OFFICIAL_ORIGIN);
      if (response.status === 401 || response.status === 403) {
        return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "OpenRouter", state: "unauthorized", fetchedAt, accounts: [], error: `OpenRouter returned HTTP ${response.status} (api key invalid)` };
      }
      if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`);
      const data = await response.json() as CreditsResponse;
      const total = data.data?.total_credits;
      const used = data.data?.total_usage;
      if (typeof total !== "number" || typeof used !== "number") {
        return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "OpenRouter", state: "empty", fetchedAt, accounts: [], error: "OpenRouter credits format unexpected" };
      }
      const remaining = Math.max(0, total - used);
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "OpenRouter",
        state: "ok",
        fetchedAt,
        summary: `Balance $${remaining.toFixed(2)}`,
        accounts: [{
          id: "openrouter-account",
          provider: "openrouter",
          label: "OpenRouter",
          status: "available",
          metrics: [{
            kind: "balance",
            id: "openrouter-balance",
            label: "Balance",
            amount: remaining,
            currency: "USD",
            detail: `Used $${used.toFixed(2)} / $${total.toFixed(2)}`,
          }],
        }],
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};

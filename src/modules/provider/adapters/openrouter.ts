import type { UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";

const OFFICIAL_ORIGIN = "https://openrouter.ai";

interface KeyResponse {
  data?: {
    label?: string;
    limit?: number | null;
    limit_remaining?: number | null;
    usage?: number;
    is_free_tier?: boolean;
  };
}

interface CreditsResponse {
  data?: {
    total_credits?: number;
    total_usage?: number;
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
      // 1. Preferred official endpoint for standard API keys: GET /api/v1/key
      const keyRes = await sameOriginFetch(new URL("/api/v1/key", OFFICIAL_ORIGIN), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal,
      }, fetchFn, OFFICIAL_ORIGIN);

      if (keyRes.status === 401) {
        return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "OpenRouter", state: "unauthorized", fetchedAt, accounts: [], error: `OpenRouter returned HTTP 401 (api key invalid)` };
      }

      if (keyRes.ok) {
        const keyData = await keyRes.json() as KeyResponse & CreditsResponse;
        const info = keyData.data;
        // Check if response matches /api/v1/key schema (has limit_remaining, limit, or is_free_tier)
        if (info && ("limit_remaining" in info || "limit" in info || "is_free_tier" in info)) {
          const metrics = [];
          let remaining: number | undefined = typeof info.limit_remaining === "number" ? info.limit_remaining : undefined;
          const usage = typeof info.usage === "number" ? info.usage : 0;
          const limit = typeof info.limit === "number" ? info.limit : null;

          if (remaining !== undefined) {
            metrics.push({
              kind: "balance" as const,
              id: "openrouter-remaining",
              label: "Remaining",
              amount: remaining,
              currency: "USD",
              detail: limit != null ? `Limit $${limit.toFixed(2)} · Used $${usage.toFixed(2)}` : `Used $${usage.toFixed(2)} (unlimited)`,
            });
          } else {
            // Key has unlimited quota, show usage
            metrics.push({
              kind: "balance" as const,
              id: "openrouter-usage",
              label: "Usage",
              amount: usage,
              currency: "USD",
              detail: "Unlimited key limit",
            });
          }

          const label = info.label ? `OpenRouter (${info.label})` : "OpenRouter";
          const summary = remaining !== undefined ? `Balance $${remaining.toFixed(2)}` : `Used $${usage.toFixed(2)}`;

          return {
            adapterId: this.id,
            sourceProviderId: target.providerId,
            displayName: "OpenRouter",
            state: "ok",
            fetchedAt,
            summary,
            accounts: [{
              id: "openrouter-account",
              provider: "openrouter",
              label,
              status: "available",
              metrics,
            }],
          };
        } else if (info && typeof info.total_credits === "number" && typeof info.total_usage === "number") {
          // In case /api/v1/credits response was returned
          const total = info.total_credits;
          const used = info.total_usage;
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
        }
      }

      // 2. Fallback for Management Keys: GET /api/v1/credits
      const creditsRes = await sameOriginFetch(new URL("/api/v1/credits", OFFICIAL_ORIGIN), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal,
      }, fetchFn, OFFICIAL_ORIGIN);

      if (creditsRes.status === 401 || creditsRes.status === 403) {
        return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "OpenRouter", state: "unauthorized", fetchedAt, accounts: [], error: `OpenRouter returned HTTP ${creditsRes.status} (api key invalid or management permission required)` };
      }

      if (!creditsRes.ok) throw new Error(`OpenRouter returned HTTP ${creditsRes.status}`);
      const data = await creditsRes.json() as CreditsResponse;
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

import type { UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";

const CN_ORIGIN = "https://api.siliconflow.cn";
const COM_ORIGIN = "https://api.siliconflow.com";

interface SiliconFlowResponse {
  code?: number;
  data?: {
    totalBalance?: string;
    chargeBalance?: string;
    balance?: string;
    status?: boolean;
  };
  message?: string;
}

function toNumber(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export const siliconFlowAdapter: UsageAdapter = {
  id: "siliconflow",
  label: "SiliconFlow",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    if (pid === "siliconflow" || pid === "siliconflow-en" || pid === "siliconflow-cn") return true;
    if (target.baseUrl) {
      try {
        const host = new URL(target.baseUrl).host;
        if (host.includes("siliconflow.cn") || host.includes("siliconflow.com")) return true;
      } catch { return false; }
    }
    return false;
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const apiKey = (target.auth?.auth as Record<string, unknown> | undefined)?.apiKey as string | undefined;
    if (!apiKey) {
      return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "SiliconFlow", state: "unauthorized", fetchedAt, accounts: [], error: "No API key found in Pi auth for SiliconFlow" };
    }
    // choose origin from baseUrl or default to CN (most CC Switch users are CN)
    let origin = CN_ORIGIN;
    if (target.baseUrl) {
      try {
        const u = new URL(target.baseUrl);
        if (u.host.includes("siliconflow.com")) origin = COM_ORIGIN;
        else if (u.host.includes("siliconflow.cn")) origin = CN_ORIGIN;
      } catch {}
    }
    try {
      // If target specifies or defaults to CN, do not blindly fallback to COM if CN deprecates it (avoids false 401)
      const tryOrigins = origin === CN_ORIGIN ? [CN_ORIGIN] : [COM_ORIGIN];
      for (const tryOrigin of tryOrigins) {
        const response = await sameOriginFetch(new URL("/v1/user/info", tryOrigin), {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
          signal,
        }, fetchFn, tryOrigin);
        if (response.status === 410) {
          return {
            adapterId: this.id,
            sourceProviderId: target.providerId,
            displayName: "SiliconFlow",
            state: "unsupported",
            fetchedAt,
            summary: "Active (balance API deprecated by SiliconFlow)",
            accounts: [{
              id: "siliconflow-account",
              provider: "siliconflow",
              label: "SiliconFlow",
              status: "available",
              metrics: [{
                kind: "status",
                id: "siliconflow-status",
                label: "Status",
                value: "Active · Official balance API deprecated",
              }],
            }],
          };
        }
        if (response.status === 401 || response.status === 403) {
          return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "SiliconFlow", state: "unauthorized", fetchedAt, accounts: [], error: `SiliconFlow returned HTTP ${response.status} (api key invalid)` };
        }
        if (!response.ok) {
          throw new Error(`SiliconFlow returned HTTP ${response.status}`);
        }
        const data = await response.json() as SiliconFlowResponse;
        const total = toNumber(data.data?.totalBalance);
        if (total === undefined) {
          return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "SiliconFlow", state: "empty", fetchedAt, accounts: [], error: "SiliconFlow balance format unexpected" };
        }
        const charge = toNumber(data.data?.chargeBalance);
        const gift = toNumber(data.data?.balance);
        const detailParts: string[] = [];
        if (charge !== undefined) detailParts.push(`Charge ¥${charge.toFixed(2)}`);
        if (gift !== undefined) detailParts.push(`Gift ¥${gift.toFixed(2)}`);
        return {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "SiliconFlow",
          state: "ok",
          fetchedAt,
          summary: `Balance ¥${total.toFixed(2)}`,
          accounts: [{
            id: "siliconflow-account",
            provider: "siliconflow",
            label: "SiliconFlow",
            status: data.data?.status === false ? "unavailable" : "available",
            metrics: [{
              kind: "balance",
              id: "siliconflow-balance",
              label: "Balance",
              amount: total,
              currency: "CNY",
              ...(detailParts.length ? { detail: detailParts.join(" · ") } : {}),
            }],
          }],
        };
      }
      throw new Error("SiliconFlow request failed");
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};

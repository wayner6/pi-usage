import type { UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";

type BalanceInfo = {
  currency?: string;
  total_balance?: string | number | null;
  granted_balance?: string | number | null;
  topped_up_balance?: string | number | null;
};
type BalanceResponse = { is_available?: boolean; balance_infos?: BalanceInfo[] };

const OFFICIAL_ORIGIN = "https://api.deepseek.com";

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function format(amount: number, currency: string): string {
  return `${currency === "CNY" || currency === "RMB" ? "¥" : currency === "USD" ? "$" : `${currency} `}${amount.toFixed(2)}`;
}

export const deepSeekAdapter: UsageAdapter = {
  id: "deepseek",
  label: "DeepSeek",
  canHandle(target) {
    const origin = target.baseUrl ? new URL(target.baseUrl).origin : undefined;
    return target.providerId.toLowerCase() === "deepseek" && (!origin || origin === OFFICIAL_ORIGIN);
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const apiKey = target.auth?.auth.apiKey;
    if (!apiKey) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "DeepSeek", state: "unauthorized", fetchedAt, accounts: [], error: "No API key resolved from Pi provider auth" };
    try {
      const response = await sameOriginFetch(new URL("/user/balance", OFFICIAL_ORIGIN), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal,
      }, fetchFn, OFFICIAL_ORIGIN);
      if (response.status === 401 || response.status === 403) return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "DeepSeek", state: "unauthorized", fetchedAt, accounts: [], error: `DeepSeek returned HTTP ${response.status}` };
      if (!response.ok) throw new Error(`DeepSeek returned HTTP ${response.status}`);
      const data = await response.json() as BalanceResponse;
      const metrics = (data.balance_infos ?? []).flatMap((info, index) => {
        const total = number(info.total_balance);
        if (total === undefined) return [];
        const currency = (info.currency ?? "credits").toUpperCase();
        const granted = number(info.granted_balance);
        const topped = number(info.topped_up_balance);
        const detail = [topped !== undefined ? `Paid ${format(topped, currency)}` : undefined, granted !== undefined ? `Granted ${format(granted, currency)}` : undefined].filter(Boolean).join(" · ");
        return [{ kind: "balance" as const, id: `balance-${currency}-${index}`, label: "Balance", amount: total, currency, ...(detail ? { detail } : {}) }];
      });
      const summary = metrics.map((metric) => format(metric.amount, metric.currency)).join(" · ");
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "DeepSeek",
        state: metrics.length ? "ok" : "empty",
        fetchedAt,
        accounts: [{ id: target.providerId, provider: "deepseek", label: "DeepSeek API", status: data.is_available === false ? "unavailable" : "available", metrics }],
        ...(summary ? { summary: `Balance ${summary}` } : {}),
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};

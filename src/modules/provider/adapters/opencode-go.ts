import type { Metric, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";
import { compactQuotaSummary } from "../../../ui/format.ts";

const OFFICIAL_ORIGIN = "https://opencode.ai";
const USAGE_PATH = "/zen/go/v1/usage";

interface UsageWindow {
  status?: string;
  percent?: number;
  resetsAt?: string;
}

interface UsageResponse {
  usage?: {
    rolling?: UsageWindow;
    weekly?: UsageWindow;
    monthly?: UsageWindow;
  };
}

function windowMetric(id: string, label: string, w?: UsageWindow): Metric | undefined {
  if (!w || typeof w.percent !== "number" || !Number.isFinite(w.percent)) return undefined;
  const used = Math.min(100, Math.max(0, w.percent));
  const remainingFraction = Math.max(0, (100 - used) / 100);
  const resetAt = w.resetsAt && !isNaN(Date.parse(w.resetsAt)) ? new Date(w.resetsAt).toISOString() : undefined;
  return {
    kind: "quota-window",
    id,
    label,
    remainingFraction,
    ...(resetAt ? { resetAt } : {}),
  };
}

export const openCodeGoAdapter: UsageAdapter = {
  id: "opencode-go",
  label: "OpenCode Go",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    if (pid === "opencode-go" || pid === "opencode" || pid === "opencode_go") return true;
    if (target.baseUrl) {
      try {
        const host = new URL(target.baseUrl).host;
        if (host.includes("opencode.ai")) return true;
      } catch { return false; }
    }
    return false;
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const apiKey = (target.auth?.auth as Record<string, unknown> | undefined)?.apiKey as string | undefined;
    if (!apiKey) {
      return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "OpenCode Go", state: "unauthorized", fetchedAt, accounts: [], error: "No API key found in Pi auth for OpenCode Go" };
    }
    try {
      const response = await sameOriginFetch(new URL(USAGE_PATH, OFFICIAL_ORIGIN), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal,
      }, fetchFn, OFFICIAL_ORIGIN);
      if (response.status === 401 || response.status === 403) {
        return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "OpenCode Go", state: "unauthorized", fetchedAt, accounts: [], error: `OpenCode Go returned HTTP ${response.status} (api key invalid or no Go subscription)` };
      }
      if (!response.ok) throw new Error(`OpenCode Go returned HTTP ${response.status}`);
      const data = await response.json() as UsageResponse;
      const metrics: Metric[] = [];
      const rolling = windowMetric("opencode-go-rolling", "OpenCode 5h", data.usage?.rolling);
      const weekly = windowMetric("opencode-go-weekly", "OpenCode Weekly", data.usage?.weekly);
      const monthly = windowMetric("opencode-go-monthly", "OpenCode Monthly", data.usage?.monthly);
      if (rolling) metrics.push(rolling);
      if (weekly) metrics.push(weekly);
      if (monthly) metrics.push(monthly);
      if (!metrics.length) {
        return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "OpenCode Go", state: "empty", fetchedAt, accounts: [], error: "No usage windows returned" };
      }
      const quotaMetrics = metrics.filter(
        (metric): metric is Extract<Metric, { kind: "quota-window" }> => metric.kind === "quota-window",
      );
      const summary = compactQuotaSummary("OpenCode", quotaMetrics, 2);
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "OpenCode Go",
        state: "ok",
        fetchedAt,
        ...(summary ? { summary } : {}),
        accounts: [{
          id: "opencode-go-account",
          provider: "opencode-go",
          label: "OpenCode Go",
          status: "available",
          metrics,
        }],
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};

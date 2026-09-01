import type { Metric, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";
import { compactQuotaSummary } from "../../../ui/format.ts";

const OFFICIAL_ORIGIN = "https://api.kimi.com";
const USAGES_PATH = "/coding/v1/usages";

interface KimiQuotaDetail {
  limit?: string | number;
  used?: string | number;
  remaining?: string | number;
  resetTime?: string;
}

interface KimiUsageLimit {
  window?: {
    duration?: number;
    timeUnit?: string;
  };
  detail?: KimiQuotaDetail;
}

interface KimiUsagesResponse {
  usage?: KimiQuotaDetail;
  limits?: KimiUsageLimit[];
}

function parseFraction(detail?: KimiQuotaDetail): number | undefined {
  if (!detail) return undefined;
  const rem = typeof detail.remaining === "number" ? detail.remaining : Number(detail.remaining);
  const lim = typeof detail.limit === "number" ? detail.limit : Number(detail.limit);
  if (Number.isFinite(rem) && Number.isFinite(lim) && lim > 0) {
    return Math.max(0, Math.min(1, rem / lim));
  }
  const used = typeof detail.used === "number" ? detail.used : Number(detail.used);
  if (Number.isFinite(used) && Number.isFinite(lim) && lim > 0) {
    return Math.max(0, Math.min(1, (lim - used) / lim));
  }
  return undefined;
}

export const kimiCodingAdapter: UsageAdapter = {
  id: "kimi-coding",
  label: "Kimi Code",

  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    const nativeId = pid === "kimi-coding" || pid === "kimi-code" || pid === "kimi" || pid === "moonshot-code";
    if (target.baseUrl) {
      try {
        const host = new URL(target.baseUrl).host;
        if (host === "api.kimi.com") return true;
        if (nativeId) return false;
      } catch {
        return false;
      }
    }
    return nativeId;
  },

  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const authObj = (target.auth?.auth as Record<string, unknown> | undefined);
    const resolvedHeaders = authObj?.headers as Record<string, string> | undefined;
    const authorization = resolvedHeaders
      ? Object.entries(resolvedHeaders).find(([name]) => name.toLowerCase() === "authorization")?.[1]
      : undefined;
    const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = (authObj?.apiKey as string | undefined) ||
      (authObj?.access as string | undefined) ||
      (authObj?.accessToken as string | undefined) ||
      (authObj?.token as string | undefined) ||
      bearerToken;

    if (!token) {
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "Kimi Code",
        state: "unauthorized",
        fetchedAt,
        accounts: [],
        error: "No API key or OAuth token found in Pi auth for Kimi Code",
      };
    }

    try {
      const response = await sameOriginFetch(
        new URL(USAGES_PATH, OFFICIAL_ORIGIN),
        {
          method: "GET",
          headers: {
            ...resolvedHeaders,
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          signal,
        },
        fetchFn,
        OFFICIAL_ORIGIN,
      );

      if (response.status === 429) {
        const data = await response.json().catch(() => null) as {
          code?: string;
          message?: string;
          details?: Array<{ debug?: { reason?: string; localizedMessage?: { message?: string } } }>;
        } | null;
        const detail = data?.details?.[0]?.debug;
        const exhausted = data?.code === "resource_exhausted" || detail?.reason === "REASON_QUOTA_EXCEEDED";
        if (!exhausted) throw new Error("Kimi Code usage endpoint is rate limited (HTTP 429)");
        const message = detail?.localizedMessage?.message || data?.message || "Quota exhausted";
        return {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "Kimi Code",
          state: "empty",
          fetchedAt,
          accounts: [{
            id: "kimi-coding",
            provider: "kimi-coding",
            label: "Kimi Code",
            status: "limit_reached",
            metrics: [{ kind: "status", id: "kimi-quota", label: "Quota", value: message }],
          }],
          summary: "No active quota",
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "Kimi Code",
          state: "unauthorized",
          fetchedAt,
          accounts: [],
          error: `Kimi Code returned HTTP ${response.status} (token expired or unauthorized)`,
        };
      }

      if (!response.ok) {
        throw new Error(`Kimi Code returned HTTP ${response.status}`);
      }

      const data = await response.json() as KimiUsagesResponse;
      const metrics: Metric[] = [];

      // 1. 5-hour rolling limit
      let fiveHourMetric: Extract<Metric, { kind: "quota-window" }> | undefined;
      const fiveHourLimit = data.limits?.find((limit) =>
        limit.window?.duration === 300 && limit.window?.timeUnit === "TIME_UNIT_MINUTE"
      );
      if (fiveHourLimit?.detail) {
        const frac = parseFraction(fiveHourLimit.detail);
        if (frac !== undefined) {
          const resetAt = fiveHourLimit.detail.resetTime && !isNaN(Date.parse(fiveHourLimit.detail.resetTime))
            ? new Date(fiveHourLimit.detail.resetTime).toISOString()
            : undefined;
          fiveHourMetric = {
            kind: "quota-window",
            id: "kimi-5h",
            label: "Kimi 5h",
            remainingFraction: frac,
            ...(resetAt ? { resetAt } : {}),
          };
          metrics.push(fiveHourMetric);
        }
      }

      // 2. Weekly limit
      let weeklyMetric: Extract<Metric, { kind: "quota-window" }> | undefined;
      if (data.usage) {
        const frac = parseFraction(data.usage);
        if (frac !== undefined) {
          const resetAt = data.usage.resetTime && !isNaN(Date.parse(data.usage.resetTime))
            ? new Date(data.usage.resetTime).toISOString()
            : undefined;
          weeklyMetric = {
            kind: "quota-window",
            id: "kimi-weekly",
            label: "Kimi Weekly",
            remainingFraction: frac,
            ...(resetAt ? { resetAt } : {}),
          };
          metrics.push(weeklyMetric);
        }
      }

      const summary = compactQuotaSummary(
        "Kimi",
        [fiveHourMetric, weeklyMetric].filter(
          (metric): metric is Extract<Metric, { kind: "quota-window" }> => Boolean(metric),
        ),
      );

      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "Kimi Code",
        state: metrics.length ? "ok" : "empty",
        fetchedAt,
        accounts: [
          {
            id: "kimi-coding",
            provider: "kimi-coding",
            label: "Kimi Code",
            metrics,
          },
        ],
        ...(summary ? { summary } : {}),
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};

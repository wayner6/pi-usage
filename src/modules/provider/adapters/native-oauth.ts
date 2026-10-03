import type { Metric, ProviderTarget, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { sameOriginFetch } from "../../../core/security.ts";
import { compactQuotaSummary } from "../../../ui/format.ts";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
const number = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const resetAt = (value: unknown): string | undefined => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
const oauthToken = (target: ProviderTarget): string | undefined => {
  if (String(target.auth?.source ?? "").toLowerCase() !== "oauth") return undefined;
  const header = Object.entries(target.auth?.auth.headers ?? {}).find(([key]) => key.toLowerCase() === "authorization")?.[1];
  return target.auth?.auth.apiKey ?? (typeof header === "string" && /^Bearer\s+\S+$/i.test(header) ? header.replace(/^Bearer\s+/i, "") : undefined);
};

/** Fixed origins and provider IDs prevent an override or custom base URL from receiving an OAuth token. */
function official(target: ProviderTarget, providerId: string, origin: string): boolean {
  if (target.providerId !== providerId) return false;
  const url = target.auth?.auth.baseUrl ?? target.baseUrl;
  if (!url) return true;
  try { return new URL(url).origin === origin; } catch { return false; }
}

function windowMetric(id: string, label: string, usedPercent: unknown, reset: unknown): Metric | undefined {
  const used = number(usedPercent);
  if (used === undefined || used < 0 || used > 100) return undefined;
  const time = resetAt(reset);
  return { kind: "quota-window", id, label, remainingFraction: (100 - used) / 100, ...(time ? { resetAt: time } : {}) };
}

function ratioMetric(id: string, label: string, used: unknown, limit: unknown, reset: unknown): Metric | undefined {
  const n = typeof used === "string" && used.trim() ? Number(used) : number(used);
  const max = typeof limit === "string" && limit.trim() ? Number(limit) : number(limit);
  if (!Number.isFinite(n) || !Number.isFinite(max) || max! <= 0 || n! < 0) return undefined;
  return windowMetric(id, label, Math.min(100, n! / max! * 100), reset);
}

function snapshot(target: ProviderTarget, id: string, name: string, metrics: Metric[], fetchedAt: string): UsageSnapshot {
  const summary = compactQuotaSummary(name, metrics);
  return {
    adapterId: id, sourceProviderId: target.providerId, displayName: name,
    state: metrics.length ? "ok" : "empty", fetchedAt,
    accounts: [{ id: target.providerId, provider: target.providerId, label: name, metrics }],
    ...(summary ? { summary } : {}),
  };
}

function nativeAdapter(
  id: string, name: string, origin: string, path: string,
  parse: (body: RecordValue) => Metric[], extraHeaders: Record<string, string> = {},
): UsageAdapter {
  return {
    id, label: name,
    canHandle(target) { return official(target, id, origin); },
    async fetch({ target, signal, fetchFn }) {
      const fetchedAt = new Date().toISOString();
      const token = oauthToken(target);
      if (!token) return { adapterId: id, sourceProviderId: target.providerId, displayName: name,
        state: "unauthorized", fetchedAt, accounts: [], error: "Pi OAuth credential is unavailable" };
      const response = await sameOriginFetch(new URL(path, origin), {
        method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...extraHeaders }, signal,
      }, fetchFn, origin);
      if (response.status === 401 || response.status === 403) return {
        adapterId: id, sourceProviderId: target.providerId, displayName: name,
        state: "unauthorized", fetchedAt, accounts: [], error: `Usage endpoint returned HTTP ${response.status}`,
      };
      if (response.status === 429) return {
        adapterId: id, sourceProviderId: target.providerId, displayName: name,
        state: "unavailable", fetchedAt, accounts: [], error: "Usage endpoint rate limited the query (HTTP 429)",
      };
      if (!response.ok) throw new Error(`${name} usage returned HTTP ${response.status}`);
      const body = record(await response.json());
      if (!body) throw new Error(`${name} usage returned an invalid response`);
      return snapshot(target, id, name, parse(body), fetchedAt);
    },
  };
}

export const anthropicOAuthAdapter = nativeAdapter("anthropic", "Claude", "https://api.anthropic.com", "/api/oauth/usage", (body) => {
  const windows = [["five_hour", "Claude 5h"], ["seven_day", "Claude 7d"], ["seven_day_opus", "Claude Opus 7d"], ["seven_day_sonnet", "Claude Sonnet 7d"]] as const;
  return windows.flatMap(([key, label]) => {
    const item = record(body[key]);
    const metric = windowMetric(key, label, item?.utilization, item?.resets_at);
    return metric ? [metric] : [];
  });
}, { "anthropic-beta": "oauth-2025-04-20" });

export const kimiCodingOAuthAdapter = nativeAdapter("kimi-coding", "Kimi Code", "https://api.kimi.com", "/coding/v1/usages", (body) => {
  const metrics: Metric[] = [];
  const pools = record(body.usages);
  const poolMetric = (id: string, label: string, raw: unknown): Metric | undefined => {
    const pool = record(raw);
    const ratio = number(pool?.used_ratio);
    return ratio !== undefined && ratio >= 0 && ratio <= 1
      ? windowMetric(id, label, ratio * 100, pool?.reset_time)
      : undefined;
  };
  const weekly = record(body.usage);
  const week = ratioMetric("7d", "Kimi Code 7d", weekly?.used, weekly?.limit, weekly?.resetTime ?? weekly?.reset_time)
    ?? poolMetric("7d", "Kimi Code 7d", pools?.limit_7d);
  if (week) metrics.push(week);
  for (const [index, raw] of (Array.isArray(body.limits) ? body.limits : []).entries()) {
    const limit = record(raw);
    const window = record(limit?.window);
    const duration = number(window?.duration);
    const unit = window?.timeUnit;
    if (!((duration === 300 && unit === "TIME_UNIT_MINUTE") || (duration === 5 && unit === "TIME_UNIT_HOUR"))) continue;
    const detail = record(limit?.detail);
    const metric = ratioMetric(`5h-${index}`, "Kimi Code 5h", detail?.used, detail?.limit, detail?.resetTime ?? detail?.reset_time);
    if (metric) { metrics.unshift(metric); break; }
    // A window descriptor without detail is not evidence that quota is 100% remaining.
  }
  if (!metrics.some((metric) => metric.id.startsWith("5h"))) {
    const session = poolMetric("5h", "Kimi Code 5h", pools?.limit_5h);
    if (session) metrics.unshift(session);
  }
  return metrics;
});

export const openRouterOAuthAdapter = nativeAdapter("openrouter", "OpenRouter", "https://openrouter.ai", "/api/v1/key", (body) => {
  const data = record(body.data);
  const metrics: Metric[] = [];
  const cap = number(data?.limit);
  const remaining = number(data?.limit_remaining);
  if (cap !== undefined && cap > 0 && remaining !== undefined && remaining >= 0) {
    const metric = windowMetric("key-cap", "OpenRouter key cap", Math.max(0, 100 - remaining / cap * 100), undefined);
    if (metric) metrics.push(metric);
  }
  const free = record(data?.free_model_daily_requests);
  const daily = ratioMetric("free-daily", "OpenRouter free daily", free?.used, free?.limit, undefined);
  if (daily) metrics.push(daily);
  // A null key cap is unlimited, not zero remaining or an account credit balance.
  return metrics;
});

import type { Metric, UsageSnapshot } from "../core/types.ts";

export function percentBar(value: number, width = 10): string {
  const count = Math.round(Math.min(1, Math.max(0, value)) * width);
  return `${"━".repeat(count)}${"─".repeat(width - count)}`;
}

export function relativeTime(value?: string): string | undefined {
  if (!value) return undefined;
  const delta = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(delta)) return undefined;
  if (delta <= 0) return "reset due";
  const minutes = Math.ceil(delta / 60000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 48) return `resets in ${hours}h${mins ? ` ${mins}m` : ""}`;
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

type QuotaWindowMetric = Extract<Metric, { kind: "quota-window" }>;

export function compactQuotaSummary(
  providerLabel: string,
  metrics: QuotaWindowMetric[],
  maxWindows = metrics.length,
): string | undefined {
  const selected = metrics.slice(0, Math.max(0, maxWindows));
  if (!selected.length) return undefined;
  const escaped = providerLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp(`^${escaped}\\s+`, "i");
  const parts = selected.map((metric) => {
    const label = metric.label.replace(prefix, "");
    const reset = relativeTime(metric.resetAt);
    return `${label} ${Math.round(metric.remainingFraction * 100)}%${reset ? ` (${reset})` : ""}`;
  });
  return `${providerLabel} · ${parts.join(" · ")}`;
}

export function metricText(metric: Metric): string {
  switch (metric.kind) {
    case "balance": {
      const symbol = metric.currency === "CNY" || metric.currency === "RMB" ? "¥" : metric.currency === "USD" ? "$" : `${metric.currency} `;
      return `${metric.label}: ${symbol}${metric.amount.toFixed(2)}${metric.detail ? ` · ${metric.detail}` : ""}`;
    }
    case "quota-window": return `${metric.label} ${percentBar(metric.remainingFraction)} ${Math.round(metric.remainingFraction * 100)}% left${relativeTime(metric.resetAt) ? ` · ${relativeTime(metric.resetAt)}` : ""}`;
    case "credits": return `${metric.label}: ${metric.remaining} ${metric.unit}`;
    case "usage-limit": return `${metric.label}: ${metric.used}/${metric.limit} ${metric.unit}`;
    case "rate-limit": return `${metric.label}: ${metric.value} ${metric.unit}`;
    case "status": return `${metric.label}: ${metric.value}`;
    case "custom": return `${metric.label}: ${metric.value}`;
  }
}

export function compactSnapshot(snapshot?: UsageSnapshot): string {
  if (!snapshot) return "Loading...";
  if (snapshot.state !== "ok" && snapshot.state !== "stale") {
    switch (snapshot.state) {
      case "unauthorized": return `${snapshot.displayName} · Unauthorized`;
      case "not-installed": return `${snapshot.displayName} · Bridge Not Found`;
      case "unsupported": return `${snapshot.displayName} · Unsupported`;
      case "empty": return snapshot.summary ? `${snapshot.displayName} · ${snapshot.summary}` : `${snapshot.displayName} · No Quota`;
      default: return `${snapshot.displayName} · ${snapshot.state}`;
    }
  }
  return `${snapshot.summary ?? snapshot.displayName}${snapshot.stale ? " · stale" : ""}`;
}

export function snapshotLines(snapshot: UsageSnapshot): string[] {
  const lines = [`${snapshot.displayName} [${snapshot.state}]${snapshot.stale ? " · stale" : ""}`];
  if (snapshot.error) lines.push(`  Error: ${snapshot.error}`);
  if (snapshot.diagnostic) lines.push(`  ${snapshot.diagnostic}`);
  for (const account of snapshot.accounts) {
    const flags = [account.status, account.disabled ? "disabled" : undefined, account.unavailable ? "unavailable" : undefined].filter(Boolean).join(", ");
    lines.push(`  ${account.provider} · ${account.label}${flags ? ` (${flags})` : ""}`);
    if (account.error) lines.push(`    Error: ${account.error}`);
    if (!account.metrics.length) lines.push("    No quota reported");
    for (const metric of account.metrics) lines.push(`    ${metricText(metric)}`);
  }
  return lines;
}

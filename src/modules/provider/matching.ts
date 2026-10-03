import type { ProviderTarget, UsageAdapter } from "../../core/types.ts";
import type { UsageConfig } from "../../core/config.ts";

export function chooseAdapter(target: ProviderTarget, adapters: UsageAdapter[], config: UsageConfig): UsageAdapter | undefined {
  const override = config.providerOverrides[target.providerId];
  if (override === "disabled") return undefined;
  if (override) return adapters.find((adapter) => adapter.id === override && adapter.canHandle(target));
  return adapters.find((adapter) => adapter.canHandle(target));
}

export type CpaGroup = {
  id: string;
  label: string;
  modelGroup: "gemini" | "claude-gpt" | "claude" | "codex" | "kimi" | "xai" | "devin" | "meta";
  window?: string;
  source: "summary" | "fallback";
  remainingFraction: number;
  resetTime?: string;
};

type CpaAccount = { provider?: string; disabled?: boolean; unavailable?: boolean; missingWindows?: string[]; rawGroups?: unknown };

export function modelGroup(modelId: string): CpaGroup["modelGroup"] | undefined {
  const tokens = modelId.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.includes("gemini")) return "gemini";
  if (tokens.includes("claude")) return "claude-gpt";
  // Antigravity's shared Claude/GPT pool covers GPT-OSS, not OpenAI GPT.
  if (tokens.includes("gpt")) return tokens[tokens.indexOf("gpt") + 1] === "oss" ? "claude-gpt" : "codex";
  if (tokens.includes("codex")) return "codex";
  if (tokens.includes("kimi") || tokens.includes("moonshot")) return "kimi";
  if (tokens.includes("grok") || tokens.includes("xai")) return "xai";
  if (tokens.includes("devin")) return "devin";
  if (tokens.includes("meta") || tokens.includes("muse")) return "meta";
  return undefined;
}

export function groupMatches(group: CpaGroup, modelId: string, provider = "antigravity"): boolean {
  const tokens = modelId.toLowerCase().split(/[^a-z0-9]+/);
  const family = modelGroup(modelId);
  const compatible = provider === "antigravity"
    ? group.modelGroup === family
    : group.modelGroup === provider && (
      (provider === "claude" && tokens.includes("claude")) ||
      (provider === "codex" && family === "codex") ||
      (provider === "kimi" && (tokens.includes("kimi") || tokens.includes("moonshot"))) ||
      (provider === "xai" && (tokens.includes("grok") || tokens.includes("xai"))) ||
      (provider === "devin" && tokens.includes("devin")) ||
      (provider === "meta" && (tokens.includes("meta") || tokens.includes("muse")))
    );
  if (!compatible) return false;
  if (provider === "claude") {
    if (["seven_day_oauth_apps", "seven_day_cowork"].includes(group.id)) return false;
    if (group.id === "seven_day_opus" && !tokens.includes("opus")) return false;
    if (group.id === "seven_day_sonnet" && !tokens.includes("sonnet")) return false;
    if (group.id === "iguana_necktie" && !tokens.includes("fable")) return false;
  }
  if (provider === "codex" && group.id.startsWith("review-")) return false;
  // Antigravity fallback observes a single model, never a shared family.
  return group.source !== "fallback" || modelId.toLowerCase().replace(/^ag-/, "") === group.id.toLowerCase();
}

export function isGroupRelevantToModels(group: CpaGroup, configuredModelIds?: string[]): boolean {
  return !configuredModelIds?.length || configuredModelIds.some((id) => groupMatches(group, id, group.modelGroup === "claude-gpt" || group.modelGroup === "gemini" ? "antigravity" : group.modelGroup));
}

export function isAccountCompatibleWithModel(account: CpaAccount, modelId: string): boolean {
  if (!account.provider || account.disabled || account.unavailable) return false;
  const groups = Array.isArray(account.rawGroups) ? account.rawGroups as CpaGroup[] : [];
  return groups.some((group) => groupMatches(group, modelId, account.provider)) ||
    (account.provider === "antigravity" && account.missingWindows?.some((window) => typeof window === "string" && window.startsWith(`${modelGroup(modelId)}-`)) === true);
}

export function matchModelAcrossAccounts<T extends CpaAccount>(accounts: T[], modelId: string): { account: T; groups: CpaGroup[] } | undefined {
  for (const account of accounts) {
    if (!isAccountCompatibleWithModel(account, modelId)) continue;
    const groups = (Array.isArray(account.rawGroups) ? account.rawGroups as CpaGroup[] : []).filter((group) => groupMatches(group, modelId, account.provider));
    if (groups.length) return { account, groups };
  }
  return undefined;
}

export function modelLabel(modelId: string): string {
  const tokens = modelId.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.includes("gemini")) return `Gemini${tokens.includes("flash") ? " Flash" : tokens.includes("pro") ? " Pro" : ""}`;
  if (tokens.includes("claude")) return `Claude${tokens.includes("opus") ? " Opus" : tokens.includes("sonnet") ? " Sonnet" : tokens.includes("haiku") ? " Haiku" : ""}`;
  if (tokens.includes("codex")) return "Codex";
  if (tokens.includes("gpt")) return "GPT";
  if (tokens.includes("kimi") || tokens.includes("moonshot")) return "Kimi";
  if (tokens.includes("grok") || tokens.includes("xai")) return "xAI";
  if (tokens.includes("devin")) return "Devin";
  if (tokens.includes("meta") || tokens.includes("muse")) return "Meta";
  return "Model";
}

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
  modelGroup: "gemini" | "claude-gpt";
  window?: string;
  source: "summary" | "fallback";
  remainingFraction: number;
  resetTime?: string;
};

type CpaAccount = {
  provider?: string;
  disabled?: boolean;
  unavailable?: boolean;
  missingWindows?: string[];
  rawGroups?: unknown;
};

export function modelGroup(modelId: string): CpaGroup["modelGroup"] | undefined {
  const tokens = modelId.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.includes("gemini")) return "gemini";
  if (tokens.includes("claude") || tokens.includes("gpt")) return "claude-gpt";
  return undefined;
}

export function groupMatches(group: CpaGroup, modelId: string): boolean {
  if (group.modelGroup !== modelGroup(modelId)) return false;
  // Fallback is a model-specific observation, not a shared model-family pool.
  return group.source !== "fallback" || modelId.toLowerCase().replace(/^ag-/, "") === group.id.toLowerCase();
}

export function isGroupRelevantToModels(group: CpaGroup, configuredModelIds?: string[]): boolean {
  return !configuredModelIds?.length || configuredModelIds.some((id) => groupMatches(group, id));
}

export function isAccountCompatibleWithModel(account: CpaAccount, modelId: string): boolean {
  const family = modelGroup(modelId);
  if (account.provider !== "antigravity" || !family || account.disabled || account.unavailable) return false;
  const groups = Array.isArray(account.rawGroups) ? account.rawGroups as CpaGroup[] : [];
  return groups.some((group) => groupMatches(group, modelId)) || account.missingWindows?.some((window) => typeof window === "string" && window.startsWith(`${family}-`)) === true;
}

export function matchModelAcrossAccounts<T extends CpaAccount>(accounts: T[], modelId: string): { account: T; groups: CpaGroup[] } | undefined {
  for (const account of accounts) {
    if (!isAccountCompatibleWithModel(account, modelId)) continue;
    const groups = (Array.isArray(account.rawGroups) ? account.rawGroups as CpaGroup[] : []).filter((group) => groupMatches(group, modelId));
    if (groups.length) return { account, groups };
  }
  return undefined;
}

export function modelLabel(modelId: string): string {
  const tokens = modelId.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.includes("gemini")) return `Gemini${tokens.includes("flash") ? " Flash" : tokens.includes("pro") ? " Pro" : ""}`;
  if (tokens.includes("claude")) return `Claude${tokens.includes("opus") ? " Opus" : tokens.includes("sonnet") ? " Sonnet" : tokens.includes("haiku") ? " Haiku" : ""}`;
  return "GPT";
}

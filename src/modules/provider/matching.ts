import type { Metric, ProviderTarget, UsageAdapter } from "../../core/types.ts";
import type { UsageConfig } from "../../core/config.ts";

export function chooseAdapter(target: ProviderTarget, adapters: UsageAdapter[], config: UsageConfig): UsageAdapter | undefined {
  const override = config.providerOverrides[target.providerId];
  if (override === "disabled") return undefined;
  if (override) return adapters.find((adapter) => adapter.id === override);
  return adapters.find((adapter) => adapter.canHandle(target));
}

export function wildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\\]\\\\]/g, "\\$&").replace(/\\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

export interface MatchedQuotaItem {
  label: string;
  remainingFraction: number;
  resetAt?: string;
}

export interface MatchedGroupQuota {
  label: string;
  remainingFraction: number;
  resetAt?: string;
  matchedModelId?: string;
  accountProvider?: string;
  /**
   * If the model specifically matches multiple distinct time windows (e.g. 5h and 7d windows for Codex),
   * they are gathered here.
   */
  multiWindows?: MatchedQuotaItem[];
}

export function tokenizeModelId(id: string): string[] {
  return id
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function friendlyGroupName(
  group: { id?: string; label?: string },
  modelId?: string,
  accountProvider?: string,
): string {
  const mTokens = tokenizeModelId(modelId ?? "");
  const gTokens = tokenizeModelId(`${group.id ?? ""} ${group.label ?? ""}`);
  const prov = (accountProvider ?? "").toLowerCase();

  const isGemini = mTokens.includes("gemini") || gTokens.includes("gemini") || prov.includes("google") || prov.includes("gemini");
  const isClaude = mTokens.includes("claude") || gTokens.includes("claude") || prov.includes("anthropic");
  const isCodex = mTokens.includes("codex") || gTokens.includes("codex") || prov.includes("codex") || gTokens.includes("5h") || gTokens.includes("7d");
  const isGpt = mTokens.includes("gpt") || mTokens.includes("openai") || prov.includes("openai");

  if (isGemini) {
    if (gTokens.includes("flash") || mTokens.includes("flash")) return "Gemini Flash";
    if (gTokens.includes("pro") || mTokens.includes("pro")) return "Gemini Pro";
    return "Gemini";
  }

  if (isClaude) {
    if (gTokens.includes("opus") || (gTokens.includes("thinking") && !gTokens.includes("flash"))) return "Claude Opus";
    if (gTokens.includes("sonnet") || gTokens.includes("other")) return "Claude Sonnet";
    if (gTokens.includes("haiku")) return "Claude Haiku";
    return "Claude";
  }

  if (isCodex || (isGpt && (gTokens.includes("5h") || gTokens.includes("primary") || gTokens.includes("7d") || gTokens.includes("secondary")))) {
    if (gTokens.includes("5h") || gTokens.includes("primary")) return "Codex 5h";
    if (gTokens.includes("7d") || gTokens.includes("secondary") || gTokens.includes("1w")) return "Codex 7d";
    return "Codex";
  }

  if (mTokens.includes("deepseek") || gTokens.includes("deepseek")) return "DeepSeek";
  if (mTokens.includes("kimi") || mTokens.includes("moonshot") || gTokens.includes("kimi")) return "Kimi";
  if (mTokens.includes("grok") || mTokens.includes("xai") || gTokens.includes("grok")) return "Grok";

  return group.label || group.id || "Quota";
}

export type RawBridgeGroup = {
  id?: string;
  label?: string;
  remainingFraction?: number;
  resetTime?: string;
  models?: Array<{ id?: string; displayName?: string; remainingFraction?: number; resetTime?: string }>;
};

export type RawBridgeAccount = {
  provider?: string;
  label?: string;
  disabled?: boolean;
  unavailable?: boolean;
  rawGroups?: unknown;
};

export function matchModelAcrossAccounts(
  accounts: RawBridgeAccount[],
  activeModelId?: string,
): { account: RawBridgeAccount; quota: MatchedGroupQuota } | undefined {
  if (!accounts.length) return undefined;
  const targetId = (activeModelId ?? "").trim().toLowerCase();
  const targetTokens = tokenizeModelId(targetId);

  interface Candidate {
    account: RawBridgeAccount;
    group: RawBridgeGroup;
    score: number;
    matchedModelId?: string | undefined;
    isTimeWindow?: boolean;
  }

  const candidates: Candidate[] = [];

  for (const account of accounts) {
    if (account.disabled || account.unavailable) continue;
    const groups = Array.isArray(account.rawGroups) ? (account.rawGroups as RawBridgeGroup[]) : [];
    for (const group of groups) {
      if (typeof group.remainingFraction !== "number") continue;

      const groupModels = group.models ?? [];
      let bestScore = 0;
      let matchedModelId: string | undefined;

      for (const m of groupModels) {
        const mid = (m.id ?? "").trim().toLowerCase();
        if (!mid) continue;

        if (mid === targetId) {
          bestScore = Math.max(bestScore, 100);
          matchedModelId = mid;
          break;
        }

        if (targetId.includes(mid) || mid.includes(targetId)) {
          const score = 80 + Math.min(10, Math.floor((Math.min(mid.length, targetId.length) / Math.max(mid.length, targetId.length)) * 10));
          if (score > bestScore) {
            bestScore = score;
            matchedModelId = mid;
          }
        }

        const mTokens = tokenizeModelId(mid);
        const overlap = mTokens.filter((t) => targetTokens.includes(t));
        if (overlap.length >= 2) {
          const score = 50 + overlap.length * 10;
          if (score > bestScore) {
            bestScore = score;
            matchedModelId = mid;
          }
        }
      }

      const gTokens = tokenizeModelId(`${group.id ?? ""} ${group.label ?? ""}`);
      const isTimeWindow = gTokens.includes("5h") || gTokens.includes("primary") || gTokens.includes("7d") || gTokens.includes("secondary");

      if (bestScore < 60) {
        const groupOverlap = gTokens.filter((t) => targetTokens.includes(t));
        const provTokens = tokenizeModelId(account.provider ?? "");
        const provOverlap = provTokens.filter((t) => targetTokens.includes(t));

        if (groupOverlap.length > 0 || provOverlap.length > 0) {
          const score = 25 + groupOverlap.length * 15 + provOverlap.length * 15;
          if (score > bestScore) {
            bestScore = score;
          }
        }
      }

      if (bestScore > 0) {
        candidates.push({
          account,
          group,
          score: bestScore,
          isTimeWindow,
          ...(matchedModelId ? { matchedModelId } : {}),
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const winner = candidates[0];
  if (winner && winner.score >= 25) {
    const matchedAccount = winner.account;

    // Check if this matched account specifically has multiple time-window quotas (like 5h and 7d for Codex)
    const groups = Array.isArray(matchedAccount.rawGroups) ? (matchedAccount.rawGroups as RawBridgeGroup[]) : [];
    const timeWindowGroups = groups.filter((g) => {
      if (typeof g.remainingFraction !== "number") return false;
      const gTokens = tokenizeModelId(`${g.id ?? ""} ${g.label ?? ""}`);
      return gTokens.includes("5h") || gTokens.includes("primary") || gTokens.includes("7d") || gTokens.includes("secondary");
    });

    let multiWindows: MatchedQuotaItem[] | undefined;
    if (winner.isTimeWindow && timeWindowGroups.length > 1) {
      multiWindows = timeWindowGroups.map((g) => ({
        label: friendlyGroupName(g, activeModelId, matchedAccount.provider),
        remainingFraction: g.remainingFraction!,
        ...(g.resetTime ? { resetAt: g.resetTime } : {}),
      }));
    }

    return {
      account: matchedAccount,
      quota: {
        label: friendlyGroupName(winner.group, activeModelId, winner.account.provider),
        remainingFraction: winner.group.remainingFraction!,
        ...(winner.group.resetTime ? { resetAt: winner.group.resetTime } : {}),
        ...(winner.matchedModelId ? { matchedModelId: winner.matchedModelId } : {}),
        ...(winner.account.provider ? { accountProvider: winner.account.provider } : {}),
        ...(multiWindows ? { multiWindows } : {}),
      },
    };
  }

  return undefined;
}

export function matchModelGroup(
  groups: RawBridgeGroup[],
  modelId?: string,
): MatchedGroupQuota | undefined {
  const res = matchModelAcrossAccounts([{ rawGroups: groups }], modelId);
  return res?.quota;
}

/**
 * Determines whether a proxy account (e.g. from pi-bridge) is relevant to the models
 * actually configured by the user for this provider in Pi.
 * If configuredModelIds is empty or omitted, all accounts are considered relevant.
 */
export function isAccountRelevantToModels(
  account: { provider?: string; rawGroups?: unknown },
  configuredModelIds?: string[],
): boolean {
  if (!configuredModelIds || configuredModelIds.length === 0) return true;

  const targetTokens = new Set(configuredModelIds.flatMap(tokenizeModelId));
  const groups = Array.isArray(account.rawGroups) ? (account.rawGroups as RawBridgeGroup[]) : [];
  const provTokens = tokenizeModelId(account.provider ?? "");

  // 1. Direct provider match or overlap with configured model tokens
  // E.g. account.provider === "codex" vs models having "codex", or "antigravity" vs "gemini"/"claude"
  const provNormalized = (account.provider ?? "").toLowerCase();
  for (const mid of configuredModelIds) {
    const mLower = mid.toLowerCase();
    if (provNormalized && (mLower.includes(provNormalized) || provNormalized.includes(mLower))) {
      return true;
    }
  }

  // Check token intersection with account provider
  if (provTokens.some((t) => targetTokens.has(t))) return true;

  // 2. Check groups and their inner models
  const modelKeywords = [
    "claude", "gemini", "codex", "gpt", "openai", "deepseek", "kimi", "moonshot", "grok", "xai",
    "thinking", "flash", "pro", "opus", "sonnet", "haiku", "turbo", "mini", "reasoning", "antigravity",
  ];
  for (const group of groups) {
    const gTokens = tokenizeModelId(`${group.id ?? ""} ${group.label ?? ""}`);
    const gOverlap = gTokens.filter((t) => targetTokens.has(t));
    if (gOverlap.some((t) => modelKeywords.includes(t)) || gOverlap.length >= 2) return true;

    for (const m of group.models ?? []) {
      const mid = (m.id ?? "").trim().toLowerCase();
      if (!mid) continue;

      for (const targetId of configuredModelIds) {
        const tid = targetId.trim().toLowerCase();
        if (mid === tid || tid.includes(mid) || mid.includes(tid)) return true;

        const mTokens = tokenizeModelId(mid);
        const overlap = mTokens.filter((t) => targetTokens.has(t));
        if (overlap.length >= 2 || overlap.some((t) => modelKeywords.includes(t))) {
          return true;
        }
      }
    }
  }

  // 3. Provider abbreviation match (e.g. "ag-" models vs "antigravity" provider)
  if (provNormalized === "antigravity" && configuredModelIds.some((id) => id.toLowerCase().startsWith("ag-"))) {
    return true;
  }

  return false;
}


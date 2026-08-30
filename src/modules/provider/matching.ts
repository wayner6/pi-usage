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

/**
 * Determines whether a specific group in a proxy account is relevant to
 * the user's configured models.
 */
export function isGroupRelevantToModels(
  group: RawBridgeGroup,
  configuredModelIds?: string[],
): boolean {
  if (!configuredModelIds || configuredModelIds.length === 0) return true;

  const targetTokens = new Set(configuredModelIds.flatMap(tokenizeModelId));
  const modelKeywords = [
    "claude", "gemini", "codex", "gpt", "openai", "deepseek", "kimi", "moonshot", "grok", "xai",
    "thinking", "flash", "pro", "opus", "sonnet", "haiku", "turbo", "mini", "reasoning",
  ];

  // Distinct tier tokens that shouldn't cross-match (e.g. 'pro' vs 'flash')
  const tierTokens = ["pro", "flash", "thinking", "opus", "sonnet", "haiku"];

  // 1. Check models explicitly listed inside the group
  for (const m of group.models ?? []) {
    const mid = (m.id ?? "").trim().toLowerCase();
    if (!mid) continue;

    for (const targetId of configuredModelIds) {
      const tid = targetId.trim().toLowerCase();
      if (mid === tid || tid.includes(mid) || mid.includes(tid)) return true;

      const mTokens = tokenizeModelId(mid);
      const overlap = mTokens.filter((t) => targetTokens.has(t));

      // Guard: If group model has 'pro' but target only has 'flash', skip unless other strong overlap
      const mHasPro = mTokens.includes("pro");
      const tHasPro = tokenizeModelId(tid).includes("pro");
      if (mHasPro !== tHasPro && (mTokens.includes("flash") || tokenizeModelId(tid).includes("flash"))) {
        continue;
      }

      if (overlap.length >= 2 || overlap.some((t) => modelKeywords.includes(t) && !tierTokens.includes(t))) {
        return true;
      }
    }
  }

  // 2. Check group label and id
  const gTokens = tokenizeModelId(`${group.id ?? ""} ${group.label ?? ""}`);

  // Distinct tier check: if group says 'pro' but user configured models don't have 'pro', reject
  for (const tier of tierTokens) {
    if (gTokens.includes(tier)) {
      if (targetTokens.has(tier)) return true;
      // Group has this tier keyword, but user configured models don't
      return false;
    }
  }

  // General model token overlap
  const gOverlap = gTokens.filter((t) => targetTokens.has(t));
  return gOverlap.length >= 2 || gOverlap.some((t) => modelKeywords.includes(t));
}

/**
 * Resolves a friendly, high-level group label based on the models contained
 * inside this quota group.
 * E.g., if a group contains 'gemini-2.5-pro' and 'gemini-3.1-pro', label it "Gemini".
 * If it contains 'claude-opus-4-6-thinking', 'claude-sonnet-4-6', and 'gpt-oss-120b-medium',
 * label it "Claude / GPT".
 */
export function resolveGroupFamilyLabel(group: RawBridgeGroup): string {
  const models = group.models ?? [];
  const families = new Set<string>();

  for (const m of models) {
    const text = `${m.id ?? ""} ${m.displayName ?? ""}`.toLowerCase();
    if (text.includes("gemini")) families.add("Gemini");
    else if (text.includes("claude")) families.add("Claude");
    else if (text.includes("gpt") || text.includes("openai")) families.add("GPT");
    else if (text.includes("codex")) families.add("Codex");
    else if (text.includes("deepseek")) families.add("DeepSeek");
    else if (text.includes("kimi") || text.includes("moonshot")) families.add("Kimi");
    else if (text.includes("grok") || text.includes("xai")) families.add("Grok");
    else if (text.includes("glm") || text.includes("zhipu")) families.add("GLM");
  }

  // Also check the group id and label if models didn't provide family clues
  const gText = `${group.id ?? ""} ${group.label ?? ""}`.toLowerCase();
  if (gText.includes("gemini")) families.add("Gemini");
  if (gText.includes("claude")) families.add("Claude");
  if (gText.includes("gpt")) families.add("GPT");
  if (gText.includes("codex")) families.add("Codex");
  if (gText.includes("pro") || gText.includes("flash")) {
    if (!families.has("Claude") && !families.has("GPT") && !families.has("Codex")) {
      families.add("Gemini");
    }
  }
  if (gText.includes("thinking") || gText.includes("other")) {
    if (!families.has("Gemini")) {
      families.add("Claude");
    }
  }

  if (families.size > 0) {
    const order = ["Gemini", "Claude", "GPT", "Codex", "DeepSeek", "Kimi", "Grok", "GLM"];
    const sorted = order.filter((f) => families.has(f));
    return sorted.join(" / ");
  }

  return group.label || group.id || "Quota";
}

/**
 * Deduplicates groups in the same account that share the exact same quota pool
 * (identical remaining fraction and identical reset time),
 * and computes clean, friendly family labels (e.g. "Gemini", "Claude / GPT").
 */
export function deduplicateSharedQuotaGroups(groups: RawBridgeGroup[]): RawBridgeGroup[] {
  const result: RawBridgeGroup[] = [];
  const visited = new Set<number>();

  for (let i = 0; i < groups.length; i++) {
    if (visited.has(i)) continue;
    const current = groups[i]!;
    const matchingIndices: number[] = [i];

    for (let j = i + 1; j < groups.length; j++) {
      if (visited.has(j)) continue;
      const other = groups[j]!;

      // Compare remainingFraction and resetTime
      if (
        typeof current.remainingFraction === "number" &&
        typeof other.remainingFraction === "number" &&
        Math.abs(current.remainingFraction - other.remainingFraction) < 0.0001 &&
        current.resetTime === other.resetTime
      ) {
        matchingIndices.push(j);
      }
    }

    if (matchingIndices.length === 1) {
      result.push({
        ...current,
        label: resolveGroupFamilyLabel(current),
      });
      visited.add(i);
    } else {
      const matchedGroups = matchingIndices.map((idx) => groups[idx]!);
      for (const idx of matchingIndices) visited.add(idx);

      const allModels = matchedGroups.flatMap((g) => g.models ?? []);
      const mergedGroup: RawBridgeGroup = {
        ...current,
        id: matchedGroups.map((g) => g.id).filter(Boolean).join("+"),
        models: allModels,
      };

      result.push({
        ...mergedGroup,
        label: resolveGroupFamilyLabel(mergedGroup),
      });
    }
  }

  return result;
}



const MODEL_FAMILIES: string[][] = [
  ["claude", "anthropic"],
  ["gemini", "google"],
  ["codex"],
  ["gpt", "openai"],
  ["kimi", "moonshot"],
  ["deepseek"],
  ["grok", "xai"],
  ["glm", "zhipu"],
  ["minimax"],
  ["qwen", "alibaba"],
];

/**
 * Checks whether an upstream proxy account is compatible with a given active model.
 * Prevents models of one family (e.g. Kimi) from blindly matching or falling back
 * to accounts of an entirely different family (e.g. Claude/Gemini in Antigravity).
 */
export function isAccountCompatibleWithModel(
  account: { provider?: string; label?: string; rawGroups?: unknown },
  modelId: string,
): boolean {
  const mTokens = tokenizeModelId(modelId);
  const provNormalized = (account.provider ?? "").toLowerCase();
  const provTokens = tokenizeModelId(provNormalized);

  // 1. Direct name match
  if (provNormalized && (modelId.toLowerCase().includes(provNormalized) || provTokens.some((t) => mTokens.includes(t)))) {
    return true;
  }

  // 2. Specific proxy provider abbreviations (e.g. "ag-" prefix with "antigravity")
  if (provNormalized === "antigravity" && modelId.toLowerCase().startsWith("ag-")) {
    return true;
  }

  // 3. Known model family matching
  const modelFamilies = MODEL_FAMILIES.filter((fam) => fam.some((k) => mTokens.includes(k)));
  if (modelFamilies.length > 0) {
    const rawGroups = Array.isArray(account.rawGroups) ? (account.rawGroups as RawBridgeGroup[]) : [];
    const groupText = rawGroups
      .map((g) => `${g.id ?? ""} ${g.label ?? ""} ${(g.models ?? []).map((m) => `${m.id ?? ""} ${m.displayName ?? ""}`).join(" ")}`)
      .join(" ");
    const accountText = `${account.provider ?? ""} ${account.label ?? ""} ${groupText}`.toLowerCase();
    const accountTokens = tokenizeModelId(accountText);

    return modelFamilies.some((fam) => fam.some((k) => accountTokens.includes(k)));
  }

  return true;
}

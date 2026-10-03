import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { UsageConfig } from "../../core/config.ts";
import { UsageCache } from "../../core/cache.ts";
import type { ProviderTarget, UsageAdapter, UsageSnapshot } from "../../core/types.ts";
import { piUsageCpaAdapter } from "./adapters/pi-usage-cpa.ts";
import { openAICodexAdapter } from "./adapters/openai-codex.ts";
import { anthropicOAuthAdapter, kimiCodingOAuthAdapter, openRouterOAuthAdapter } from "./adapters/native-oauth.ts";
import { chooseAdapter, matchModelAcrossAccounts, isAccountCompatibleWithModel, modelLabel } from "./matching.ts";
import { relativeTime } from "../../ui/format.ts";
import { safeError } from "../../core/security.ts";

export class ProviderUsageController {
  readonly cache = new UsageCache();
  private adapters: UsageAdapter[];
  private lastAnthropicQuery = new Map<string, number>();

  constructor(private config: UsageConfig, private fetchFn: typeof fetch = fetch) {
    this.adapters = [openAICodexAdapter, anthropicOAuthAdapter, kimiCodingOAuthAdapter, openRouterOAuthAdapter, piUsageCpaAdapter];
  }

  setConfig(config: UsageConfig): void { this.config = config; }

  async target(ctx: ExtensionContext, providerId: string, model?: Model<Api>): Promise<ProviderTarget> {
    const provider = ctx.modelRegistry.getProvider(providerId);
    let auth: ProviderTarget["auth"];
    let authError: string | undefined;
    try {
      auth = await ctx.modelRegistry.getProviderAuth(providerId);
    } catch (error) {
      // Adapter selection still works when the credential resolver fails.
      authError = safeError(error);
    }

    const activeModel = model ?? ctx.model;
    const matchedModel = activeModel?.provider?.toLowerCase() === providerId.toLowerCase() ? activeModel : undefined;
    const baseUrl = auth?.auth.baseUrl ?? matchedModel?.baseUrl ?? provider?.baseUrl;
    const configuredModelIds = ctx.modelRegistry.getAll()
      .filter((m) => m.provider?.toLowerCase() === providerId.toLowerCase())
      .map((m) => m.id);

    return {
      providerId,
      ...(matchedModel ? { model: matchedModel } : {}),
      ...(provider ? { provider } : {}),
      ...(auth ? { auth } : {}),
      ...(authError ? { authError } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(configuredModelIds.length ? { configuredModelIds } : {}),
    };
  }

  private enabled(adapter: UsageAdapter): boolean {
    if (adapter.id === "openai-codex") return this.config.adapters.openaiCodex.enabled;
    if (adapter.id === "pi-usage-cpa") return this.config.adapters.piUsageCpa.enabled;
    return this.config.adapters.nativeOAuth.enabled;
  }

  async fetchTarget(target: ProviderTarget, force = false): Promise<UsageSnapshot> {
    const adapter = chooseAdapter(target, this.adapters.filter((item) => this.enabled(item)), this.config);
    const displayName = target.provider?.name ?? target.providerId;
    if (!adapter) return { adapterId: "none", sourceProviderId: target.providerId, displayName, state: "unsupported", fetchedAt: new Date().toISOString(), accounts: [], error: "No enabled usage adapter matched this provider" };
    if (target.authError) return { adapterId: adapter.id, sourceProviderId: target.providerId, displayName, state: "unavailable", fetchedAt: new Date().toISOString(), accounts: [], error: `Provider authentication could not be resolved: ${target.authError}` };
    const key = `${target.providerId}:${adapter.id}`;
    if (adapter.id === "anthropic" && !force && Date.now() - (this.lastAnthropicQuery.get(key) ?? 0) < 15 * 60_000) {
      const cached = this.cache.get(key);
      if (cached) return cached;
    }
    return this.cache.coalesce(key, async () => {
      if (adapter.id === "anthropic") this.lastAnthropicQuery.set(key, Date.now());
      const timeout = AbortSignal.timeout(this.config.refresh.timeoutSeconds * 1000);
      return adapter.fetch({ target, signal: timeout, force, fetchFn: this.fetchFn });
    });
  }

  async refreshCurrent(ctx: ExtensionContext, force = false, model: Model<Api> | undefined = ctx.model): Promise<UsageSnapshot | undefined> {
    if (!model) return undefined;
    return this.fetchTarget(await this.target(ctx, model.provider, model), force);
  }

  async refreshAll(ctx: ExtensionContext, force = false): Promise<UsageSnapshot[]> {
    const providerIds = new Set<string>();
    for (const model of ctx.modelRegistry.getAvailable()) {
      if (model.provider) providerIds.add(model.provider);
    }
    for (const id of ctx.modelRegistry.getRegisteredProviderIds()) {
      if (ctx.modelRegistry.getProviderAuthStatus(id).configured) providerIds.add(id);
    }
    for (const id of ["openai-codex", "anthropic", "kimi-coding", "openrouter"]) {
      if (ctx.modelRegistry.getProviderAuthStatus(id).configured) providerIds.add(id);
    }
    for (const id of Object.keys(this.config.providerOverrides)) providerIds.add(id);
    if (ctx.model?.provider) providerIds.add(ctx.model.provider);

    const targets = await Promise.all([...providerIds].map((id) => this.target(ctx, id)));
    const supported = targets.filter((target) => chooseAdapter(target, this.adapters.filter((item) => this.enabled(item)), this.config));
    return Promise.all(supported.map((target) => this.fetchTarget(target, force)));
  }

  currentView(ctx: ExtensionContext, snapshot?: UsageSnapshot, model: Model<Api> | undefined = ctx.model): UsageSnapshot | undefined {
    if (!snapshot || snapshot.adapterId !== "pi-usage-cpa" || (snapshot.state !== "ok" && snapshot.state !== "stale")) return snapshot;
    if (!model?.id) return { ...snapshot, accounts: [], state: "empty", summary: "No Quota · no active model" };
    const eligible = snapshot.accounts.filter((a) => isAccountCompatibleWithModel(a, model.id));
    if (eligible.length > 1) return { ...snapshot, accounts: eligible, summary: `${eligible.length} accounts · routing account unknown` };
    const matched = matchModelAcrossAccounts(eligible, model.id);
    if (matched) {
      const label = modelLabel(model.id);
      if (matched.account.provider !== "antigravity") {
        const parts = matched.groups.map((g) => {
          const reset = relativeTime(g.resetTime);
          return `${g.label} ${Math.round(g.remainingFraction * 100)}%${reset ? ` (${reset})` : ""}`;
        });
        return { ...snapshot, accounts: [matched.account], summary: `${label} · ${parts.join(" · ")}` };
      }
      const windows = matched.groups.filter((group) => group.source === "summary" && (group.window === "5h" || group.window === "7d"));
      if (windows.length) {
        const parts = ["5h", "7d"].map((window) => {
          const group = windows.find((g) => g.window === window);
          if (!group) return `${window} unavailable`;
          const reset = relativeTime(group.resetTime);
          return `${window} ${Math.round(group.remainingFraction * 100)}%${reset ? ` (${reset})` : ""}`;
        });
        return { ...snapshot, accounts: [matched.account], summary: `${label} · ${parts.join(" · ")}` };
      }
      const fallback = matched.groups.find((group) => group.source === "fallback");
      if (fallback) {
        const reset = relativeTime(fallback.resetTime);
        return { ...snapshot, accounts: [matched.account], summary: `${label} ${Math.round(fallback.remainingFraction * 100)}%${reset ? ` (${reset})` : ""} · window unknown · 5h/7d unavailable` };
      }
    }
    if (eligible.length) return { ...snapshot, accounts: eligible, state: "empty", summary: `${model.id} · 5h unavailable · 7d unavailable` };
    return { ...snapshot, accounts: [], state: "empty", summary: `No Quota · ${model.id}` };
  }
}

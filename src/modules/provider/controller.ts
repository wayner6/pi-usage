import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { UsageConfig } from "../../core/config.ts";
import { UsageCache } from "../../core/cache.ts";
import type { Metric, ProviderTarget, UsageAdapter, UsageSnapshot } from "../../core/types.ts";
import { anthropicAdapter } from "./adapters/anthropic.ts";
import { cliProxyBridgeAdapter } from "./adapters/cliproxy-pi-bridge.ts";
import { deepSeekAdapter } from "./adapters/deepseek.ts";
import { glmAdapter } from "./adapters/glm.ts";
import { openAICodexAdapter } from "./adapters/openai-codex.ts";
import { openCodeGoAdapter } from "./adapters/opencode-go.ts";
import { openRouterAdapter } from "./adapters/openrouter.ts";
import { xaiAdapter } from "./adapters/xai.ts";
import { kimiCodingAdapter } from "./adapters/kimi-coding.ts";
import { chooseAdapter, matchModelAcrossAccounts, isAccountCompatibleWithModel, tokenizeModelId } from "./matching.ts";
import { relativeTime } from "../../ui/format.ts";

export class ProviderUsageController {
  readonly cache = new UsageCache();
  private adapters: UsageAdapter[];

  constructor(private config: UsageConfig, private fetchFn: typeof fetch = fetch) {
    this.adapters = [deepSeekAdapter, openAICodexAdapter, xaiAdapter, anthropicAdapter, glmAdapter, openRouterAdapter, openCodeGoAdapter, kimiCodingAdapter, cliProxyBridgeAdapter];
  }

  setConfig(config: UsageConfig): void { this.config = config; }

  async target(ctx: ExtensionContext, providerId: string, model?: Model<Api>): Promise<ProviderTarget> {
    const provider = ctx.modelRegistry.getProvider(providerId);
    const auth = await ctx.modelRegistry.getProviderAuth(providerId);

    // Only associate the active model if it actually belongs to this provider!
    const activeModel = model ?? ctx.model;
    const matchedModel = activeModel?.provider?.toLowerCase() === providerId.toLowerCase() ? activeModel : undefined;

    // Base URL resolution: NEVER inherit baseUrl from a foreign provider's model!
    const baseUrl = auth?.auth.baseUrl ?? matchedModel?.baseUrl ?? provider?.baseUrl;

    // Collect all models configured in Pi under this specific provider
    const allModels = ctx.modelRegistry.getAll();
    const configuredModelIds = allModels
      .filter((m) => m.provider?.toLowerCase() === providerId.toLowerCase())
      .map((m) => m.id);

    return {
      providerId,
      ...(matchedModel ? { model: matchedModel } : {}),
      ...(provider ? { provider } : {}),
      ...(auth ? { auth } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(configuredModelIds.length ? { configuredModelIds } : {}),
    };
  }

  private enabled(adapter: UsageAdapter): boolean {
    if (adapter.id === "deepseek") return this.config.adapters.deepseek.enabled;
    if (adapter.id === "cliproxy-pi-bridge") return this.config.adapters.cliproxyPiBridge.enabled;
    if (adapter.id === "openai-codex") return this.config.adapters.openaiCodex.enabled;
    if (adapter.id === "xai") return this.config.adapters.xai.enabled;
    if (adapter.id === "anthropic") return this.config.adapters.anthropic.enabled;
    if (adapter.id === "glm") return this.config.adapters.glm.enabled;
    if (adapter.id === "openrouter") return this.config.adapters.openrouter.enabled;
    if (adapter.id === "opencode-go") return this.config.adapters.opencodeGo.enabled;
    return true;
  }

  async fetchTarget(target: ProviderTarget, force = false): Promise<UsageSnapshot> {
    const adapter = chooseAdapter(target, this.adapters.filter((item) => this.enabled(item)), this.config);
    if (!adapter) return { adapterId: "none", sourceProviderId: target.providerId, displayName: target.providerId, state: "unsupported", fetchedAt: new Date().toISOString(), accounts: [], error: "No enabled usage adapter matched this provider" };
    const key = `${target.providerId}:${adapter.id}`;
    return this.cache.coalesce(key, async () => {
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

    // 1. Providers that have available models registered
    for (const model of ctx.modelRegistry.getAvailable()) {
      if (model.provider) providerIds.add(model.provider);
    }

    // 2. Providers explicitly registered or configured in auth
    for (const id of ctx.modelRegistry.getRegisteredProviderIds()) {
      // Only include if provider is actively configured with credentials
      if (ctx.modelRegistry.getProviderAuthStatus(id).configured) {
        providerIds.add(id);
      }
    }

    // 3. Known standard providers with configured auth
    const knownProviders = [
      "deepseek",
      "openai-codex",
      "xai",
      "anthropic",
      "zai-coding-cn",
      "zai",
      "glm",
      "openrouter",
      "opencode-go",
      "opencode",
    ];
    for (const id of knownProviders) {
      if (ctx.modelRegistry.getProviderAuthStatus(id).configured) {
        providerIds.add(id);
      }
    }

    // 4. Config overrides & active model provider
    for (const id of Object.keys(this.config.providerOverrides)) {
      providerIds.add(id);
    }
    if (ctx.model?.provider) {
      providerIds.add(ctx.model.provider);
    }

    const targets = await Promise.all([...providerIds].map((id) => this.target(ctx, id)));
    const snapshots = await Promise.all(targets.map((target) => this.fetchTarget(target, force)));
    return snapshots.filter((snapshot) => snapshot.state !== "unsupported");
  }

  /**
   * Derive a view tailored to the active model using universal cross-account group matching.
   */
  currentView(ctx: ExtensionContext, snapshot?: UsageSnapshot, model: Model<Api> | undefined = ctx.model): UsageSnapshot | undefined {
    if (!snapshot) return undefined;
    if (snapshot.adapterId !== "cliproxy-pi-bridge" && snapshot.adapterId !== "openai-codex") return snapshot;

    const matched = matchModelAcrossAccounts(snapshot.accounts, model?.id);
    if (matched) {
      let summary: string;

      if (matched.quota.multiWindows && matched.quota.multiWindows.length > 1) {
        // Special case: Multiple time windows for the same model (e.g. Codex 5h and 7d)
        const parts = matched.quota.multiWindows.map((q) => {
          const sub = q.label.replace(/^Codexs+/, "");
          const reset = q.resetAt ? relativeTime(q.resetAt) : undefined;
          return `${sub} ${Math.round(q.remainingFraction * 100)}%${reset ? ` (${reset})` : ""}`;
        });
        summary = `Codex ${parts.join(" · ")}`;
      } else {
        const reset = matched.quota.resetAt ? relativeTime(matched.quota.resetAt) : undefined;
        summary = `${matched.quota.label} ${Math.round(matched.quota.remainingFraction * 100)}%${reset ? ` (${reset})` : ""}`;
      }

      return {
        ...snapshot,
        accounts: [matched.account as never],
        state: snapshot.state,
        summary,
      };
    }

    // If a specific model is requested but no group matched:
    if (model?.id) {
      const mTokens = tokenizeModelId(model.id);

      // Check if upstream diagnostic reports this model provider as unsupported
      if (snapshot.diagnostic && snapshot.diagnostic.includes("Unsupported upstream providers:")) {
        const list = snapshot.diagnostic.split(":")[1]?.toLowerCase() ?? "";
        if (mTokens.some((t) => list.includes(t))) {
          const provName = mTokens.find((t) => list.includes(t)) ?? model.id;
          const capitalized = provName.charAt(0).toUpperCase() + provName.slice(1);
          return {
            ...snapshot,
            state: "unsupported",
            summary: `${capitalized} · Unsupported by proxy`,
          };
        }
      }

      // Check if there are accounts compatible with this model
      const compatibleAccounts = snapshot.accounts.filter(
        (a) => !a.disabled && !a.unavailable && isAccountCompatibleWithModel(a, model.id)
      );

      if (compatibleAccounts.length > 0) {
        const first = compatibleAccounts[0]!;
        if (first.metrics.length > 0) {
          const worst = first.metrics
            .filter((m): m is Extract<Metric, { kind: "quota-window" }> => m.kind === "quota-window")
            .sort((a, b) => a.remainingFraction - b.remainingFraction)[0];
          if (worst) {
            const reset = worst.resetAt ? relativeTime(worst.resetAt) : undefined;
            return {
              ...snapshot,
              accounts: [first],
              summary: `${worst.label} ${Math.round(worst.remainingFraction * 100)}%${reset ? ` (${reset})` : ""}`,
            };
          }
        }
        return {
          ...snapshot,
          accounts: [first],
          state: "empty",
          summary: `${first.label || first.provider} · No Quota Reported`,
        };
      }

      // Model belongs to a family not present or not compatible with any account in this proxy
      return {
        ...snapshot,
        accounts: [],
        state: "empty",
        summary: `No Quota · ${model.id}`,
      };
    }

    // Standard fallback when no model is specified at all:
    const activeAccounts = snapshot.accounts.filter((a) => !a.disabled && !a.unavailable);
    const worst = activeAccounts
      .flatMap((a) => a.metrics)
      .filter((m): m is Extract<Metric, { kind: "quota-window" }> => m.kind === "quota-window")
      .sort((a, b) => a.remainingFraction - b.remainingFraction)[0];

    const reset = worst?.resetAt ? relativeTime(worst.resetAt) : undefined;
    const summary = worst ? `${worst.label} ${Math.round(worst.remainingFraction * 100)}%${reset ? ` (${reset})` : ""}` : undefined;

    return {
      ...snapshot,
      state: snapshot.accounts.length ? snapshot.state : "empty",
      ...(summary ? { summary } : {}),
    };
  }
}

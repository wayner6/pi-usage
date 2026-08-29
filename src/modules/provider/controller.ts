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
import { xaiAdapter } from "./adapters/xai.ts";
import { chooseAdapter, matchModelAcrossAccounts } from "./matching.ts";
import { relativeTime } from "../../ui/format.ts";

export class ProviderUsageController {
  readonly cache = new UsageCache();
  private adapters: UsageAdapter[];

  constructor(private config: UsageConfig, private fetchFn: typeof fetch = fetch) {
    this.adapters = [deepSeekAdapter, openAICodexAdapter, xaiAdapter, anthropicAdapter, glmAdapter, cliProxyBridgeAdapter];
  }

  setConfig(config: UsageConfig): void { this.config = config; }

  async target(ctx: ExtensionContext, providerId: string, model = ctx.model): Promise<ProviderTarget> {
    const provider = ctx.modelRegistry.getProvider(providerId);
    const auth = await ctx.modelRegistry.getProviderAuth(providerId);
    const baseUrl = auth?.auth.baseUrl ?? model?.baseUrl ?? provider?.baseUrl;
    return {
      providerId,
      ...(model?.provider === providerId ? { model } : {}),
      ...(provider ? { provider } : {}),
      ...(auth ? { auth } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    };
  }

  private enabled(adapter: UsageAdapter): boolean {
    if (adapter.id === "deepseek") return this.config.adapters.deepseek.enabled;
    if (adapter.id === "cliproxy-pi-bridge") return this.config.adapters.cliproxyPiBridge.enabled;
    if (adapter.id === "openai-codex") return this.config.adapters.openaiCodex.enabled;
    if (adapter.id === "xai") return this.config.adapters.xai.enabled;
    if (adapter.id === "anthropic") return this.config.adapters.anthropic.enabled;
    if (adapter.id === "glm") return this.config.adapters.glm.enabled;
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
    const providerIds = new Set(ctx.modelRegistry.getAvailable().map((model) => model.provider));
    for (const id of ctx.modelRegistry.getRegisteredProviderIds()) providerIds.add(id);
    if (ctx.modelRegistry.getProviderAuthStatus("deepseek").configured) providerIds.add("deepseek");
    if (ctx.modelRegistry.getProviderAuthStatus("openai-codex").configured) providerIds.add("openai-codex");
    if (ctx.modelRegistry.getProviderAuthStatus("xai").configured) providerIds.add("xai");
    if (ctx.modelRegistry.getProviderAuthStatus("anthropic").configured) providerIds.add("anthropic");
    if (ctx.modelRegistry.getProviderAuthStatus("zai-coding-cn").configured) providerIds.add("zai-coding-cn");
    if (ctx.modelRegistry.getProviderAuthStatus("zai").configured) providerIds.add("zai");
    if (ctx.modelRegistry.getProviderAuthStatus("glm").configured) providerIds.add("glm");
    for (const id of Object.keys(this.config.providerOverrides)) providerIds.add(id);
    if (ctx.model) providerIds.add(ctx.model.provider);
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
          const sub = q.label.replace(/^Codex\s+/, "");
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

    // Fallback: If snapshot has accounts with metrics, check if it's an openai-codex or time-window multi metric
    const activeAccounts = snapshot.accounts.filter((a) => !a.disabled && !a.unavailable);
    const firstAccount = activeAccounts[0];
    if (firstAccount && firstAccount.metrics.length > 1) {
      const windowMetrics = firstAccount.metrics.filter((m): m is Extract<Metric, { kind: "quota-window" }> => m.kind === "quota-window");
      const allCodex = windowMetrics.length > 1 && windowMetrics.every((m) => m.label.startsWith("Codex"));
      if (allCodex) {
        const parts = windowMetrics.map((m) => {
          const sub = m.label.replace(/^Codex\s+/, "");
          const reset = m.resetAt ? relativeTime(m.resetAt) : undefined;
          return `${sub} ${Math.round(m.remainingFraction * 100)}%${reset ? ` (${reset})` : ""}`;
        });
        return {
          ...snapshot,
          state: snapshot.state,
          summary: `Codex ${parts.join(" · ")}`,
        };
      }
    }

    // Standard fallback: pick the lowest metric from all active accounts
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

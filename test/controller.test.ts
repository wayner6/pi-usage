import type { UsageSnapshot } from "../src/core/types.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ProviderUsageController } from "../src/modules/provider/controller.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

const fixture = async (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("controller.refreshAll queries Codex OAuth and pi-usage-cpa, filtering unrelated models", async () => {
  const cpaBody = await fixture("pi-usage-cpa.json");
  const codexBody = await fixture("openai-codex-usage.json");
  const requestedUrls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("cpa.example.com")) return new Response(cpaBody);
    if (url.includes("chatgpt.com")) return new Response(codexBody);
    return new Response("Not found", { status: 404 });
  };
  const controller = new ProviderUsageController(DEFAULT_CONFIG, mockFetch);
  const activeModel = { id: "ag-claude-opus-4-6-thinking", provider: "MyCPA", baseUrl: "https://cpa.example.com/v1" };
  const models = [activeModel, { id: "ag-gemini-3-flash", provider: "MyCPA" }, { id: "deepseek-chat", provider: "deepseek" }, { id: "codex-5", provider: "openai-codex" }];
  const context: any = {
    model: activeModel,
    modelRegistry: {
      getAll: () => models, getAvailable: () => models, getRegisteredProviderIds: () => ["MyCPA"],
      getProvider: (id: string) => id === "MyCPA" ? { baseUrl: activeModel.baseUrl } : undefined,
      getProviderAuthStatus: (id: string) => ({ configured: id === "openai-codex" || id === "deepseek" }),
      getProviderAuth: async (id: string) => ({ auth: { apiKey: id === "openai-codex" ? "codex-token" : "synthetic-key" }, source: id === "openai-codex" ? "oauth" : "models.json" }),
    },
  };
  const snapshots = await controller.refreshAll(context, true);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots.some((s) => s.sourceProviderId === "deepseek"), false);
  assert.deepEqual(requestedUrls.filter((u) => u.includes("cpa.example.com")).map((u) => new URL(u).pathname), ["/v0/resource/plugins/pi-usage-cpa/usage"]);
  const cpa = snapshots.find((s) => s.displayName === "MyCPA");
  assert.equal(cpa?.state, "ok");
  assert.equal(cpa?.accounts.length, 1);
  assert.equal(cpa?.accounts[0]?.metrics.length, 4);
  assert.equal(snapshots.find((s) => s.displayName === "OpenAI Codex")?.accounts[0]?.metrics.length, 2);
});

test("controller isolates cached and pending queries by origin, credential and configured models", async () => {
  let calls = 0;
  let fail = false;
  const controller = new ProviderUsageController(DEFAULT_CONFIG, async () => {
    calls++;
    if (fail) throw new Error("offline Bearer synthetic-secret");
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({ schemaVersion: 1, accounts: [] });
  });
  const first = { providerId: "MyCPA", baseUrl: "https://one.example/v1", auth: { auth: { apiKey: "synthetic-one" }, source: "config" } };
  const second = { ...first, auth: { auth: { apiKey: "synthetic-two" }, source: "config" } };
  await Promise.all([controller.fetchTarget(first), controller.fetchTarget(second)]);
  assert.equal(calls, 2);
  assert.ok(controller.cached(first));
  assert.ok(controller.cached(second));
  assert.equal(controller.cached({ ...first, baseUrl: "https://two.example/v1" }), undefined);
  assert.equal(controller.cached({ ...first, configuredModelIds: ["gpt-6.1-sol"] }), undefined);
  assert.equal(controller.cached({ ...first, authError: "resolver failed" }), undefined);
  fail = true;
  const other = await controller.fetchTarget({ ...first, auth: { auth: { apiKey: "synthetic-third" }, source: "config" } });
  assert.equal(other.state, "unavailable");
  assert.doesNotMatch(other.error ?? "", /synthetic-secret/);
  assert.equal((await controller.fetchTarget(first)).state, "stale");
});

test("fractional timeout settings produce valid integer millisecond deadlines", async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.refresh.timeoutSeconds = 2.01;
  const controller = new ProviderUsageController(config, async () => Response.json({ schemaVersion: 1, accounts: [] }));
  const result = await controller.fetchTarget({ providerId: "MyCPA", baseUrl: "https://cpa.example/v1", auth: { auth: { apiKey: "synthetic-key" } } as any });
  assert.equal(result.state, "empty");
});

test("one failed provider does not abort refreshAll", async () => {
  const controller = new ProviderUsageController(DEFAULT_CONFIG, async (url) => {
    if (String(url).includes("chatgpt.com")) throw new Error("offline");
    return Response.json({ schemaVersion: 1, accounts: [] });
  });
  const ids = ["MyCPA", "openai-codex"];
  const ctx: any = { modelRegistry: {
    getAll: () => [], getAvailable: () => [], getRegisteredProviderIds: () => ids,
    getProviderAuthStatus: (id: string) => ({ configured: ids.includes(id) }),
    getProvider: (id: string) => id === "MyCPA" ? { baseUrl: "https://cpa.example/v1" } : undefined,
    getProviderAuth: async (id: string) => ({ auth: { apiKey: "synthetic-key" }, source: id === "MyCPA" ? "config" : "oauth" }),
  } };
  const result = await controller.refreshAll(ctx);
  assert.equal(result.length, 2);
  assert.equal(result.find((s) => s.sourceProviderId === "openai-codex")?.state, "unavailable");
  assert.equal(result.find((s) => s.sourceProviderId === "MyCPA")?.state, "empty");
});

test("unsupported providers never leave the footer at Loading", async () => {
  const controller = new ProviderUsageController(DEFAULT_CONFIG);
  const model = { id: "gemini-3.1-pro-preview", provider: "google-vertex", baseUrl: "https://us-central1-aiplatform.googleapis.com" };
  const context: any = {
    model,
    modelRegistry: {
      getProvider: () => ({ id: "google-vertex", name: "Google Vertex AI", baseUrl: model.baseUrl }),
      getProviderAuth: async () => { throw new Error("ADC could not be resolved"); }, getAll: () => [model],
    },
  };
  const snapshot = await controller.refreshCurrent(context, false, model as any);
  assert.equal(snapshot?.state, "unsupported");
  assert.equal(snapshot?.displayName, "Google Vertex AI");
});

test("controller.currentView preserves native Codex windows", () => {
  const controller = new ProviderUsageController(DEFAULT_CONFIG);
  const snapshot: UsageSnapshot = {
    adapterId: "openai-codex", sourceProviderId: "openai-codex", displayName: "OpenAI Codex", state: "ok",
    fetchedAt: new Date().toISOString(), summary: "Codex · 5h 91% · 7d 74%",
    accounts: [{ id: "codex-account", provider: "openai-codex", label: "ChatGPT Plus", metrics: [
      { kind: "quota-window", id: "primary-window", label: "Codex 5h", remainingFraction: 0.91 },
      { kind: "quota-window", id: "secondary-window", label: "Codex 7d", remainingFraction: 0.74 },
    ] }],
  };
  const view = controller.currentView({} as any, snapshot, { id: "gpt-5.4", provider: "openai-codex" } as any);
  assert.equal(view?.summary, "Codex · 5h 91% · 7d 74%");
});

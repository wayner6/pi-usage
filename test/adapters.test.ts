import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cliProxyBridgeAdapter } from "../src/modules/provider/adapters/cliproxy-pi-bridge.ts";
import { openAICodexAdapter } from "../src/modules/provider/adapters/openai-codex.ts";
import { chooseAdapter, deduplicateSharedQuotaGroups, matchModelAcrossAccounts, isAccountCompatibleWithModel, isAccountRelevantToModels } from "../src/modules/provider/matching.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

const fixture = async (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const auth = { auth: { apiKey: "sk-test" }, source: "test" };
const signal = new AbortController().signal;

test("pi-bridge parses and deduplicates quota windows", async () => {
  const snapshot = await cliProxyBridgeAdapter.fetch({
    target: { providerId: "MyCPA", baseUrl: "https://cpa.example.com/v1", auth }, signal, force: false,
    fetchFn: async () => new Response(await fixture("pi-bridge-usage.json")),
  });
  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.accounts.length, 2);
  assert.equal(snapshot.accounts.find((a) => a.provider === "antigravity")?.metrics.length, 2);
  assert.equal(snapshot.accounts.find((a) => a.provider === "codex")?.metrics.length, 2);
});

test("pi-bridge missing endpoint is not zero quota", async () => {
  const snapshot = await cliProxyBridgeAdapter.fetch({
    target: { providerId: "MyCPA", baseUrl: "https://cpa.example.com/v1", auth }, signal, force: false,
    fetchFn: async () => new Response("not found", { status: 404 }),
  });
  assert.equal(snapshot.state, "not-installed");
  assert.equal(snapshot.accounts.length, 0);
});

test("Codex OAuth parses 5h and 7d windows", async () => {
  const snapshot = await openAICodexAdapter.fetch({
    target: { providerId: "openai-codex", baseUrl: "https://chatgpt.com/backend-api", auth: { auth: { apiKey: "mock-token" }, source: "oauth" } },
    signal, force: false,
    fetchFn: async () => new Response(await fixture("openai-codex-usage.json")),
  });
  assert.equal(snapshot.state, "ok");
  assert.deepEqual(snapshot.accounts[0]?.metrics.map((m) => m.label), ["Codex 5h", "Codex 7d"]);
  assert.match(snapshot.summary ?? "", /^Codex · 5h 99% \(.+\) · 7d 78% \(.+\)$/);
});

test("Codex binds the account header to the resolved OAuth token, not local auth files", async () => {
  const token = (account: string) => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.signature`;
  const seen: string[] = [];
  for (const account of ["account-one", "account-two"]) {
    const snapshot = await openAICodexAdapter.fetch({
      target: { providerId: "openai-codex", auth: { auth: { apiKey: token(account) }, source: "OAuth" } },
      signal, force: false,
      fetchFn: async (_url, init) => {
        seen.push(new Headers(init?.headers).get("ChatGPT-Account-Id") ?? "");
        return new Response(await fixture("openai-codex-usage.json"));
      },
    });
    assert.equal(snapshot.state, "ok");
  }
  assert.deepEqual(seen, ["account-one", "account-two"]);
});

test("Codex parses additional model quotas without replacing the ordinary footer", async () => {
  const data = JSON.parse(await fixture("openai-codex-usage.json"));
  data.additional_rate_limits = [null, {
    limit_name: "GPT-5.4 Mini",
    metered_feature: "gpt-5.4-mini",
    rate_limit: {
      primary_window: { used_percent: 75, limit_window_seconds: 18000, reset_at: 1788008289 },
      secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1788487399 },
    },
  }];
  const snapshot = await openAICodexAdapter.fetch({
    target: { providerId: "openai-codex", auth: { auth: { apiKey: "not-a-jwt" }, source: "oauth" } },
    signal, force: false,
    fetchFn: async (_url, init) => {
      assert.equal(new Headers(init?.headers).has("ChatGPT-Account-Id"), false);
      return Response.json(data);
    },
  });
  assert.equal(snapshot.state, "ok");
  assert.deepEqual(snapshot.accounts[0]?.metrics.map((m) => m.label), ["Codex 5h", "Codex 7d", "GPT-5.4 Mini · 5h", "GPT-5.4 Mini · 7d"]);
  assert.match(snapshot.summary ?? "", /^Codex · 5h 99% /);
  assert.doesNotMatch(snapshot.summary ?? "", /Mini/);
  assert.deepEqual(snapshot.accounts[0]?.metrics.slice(2).map((m) => m.remainingFraction), [0.25, 0.6]);

  delete data.rate_limit;
  const additionalOnly = await openAICodexAdapter.fetch({
    target: { providerId: "openai-codex", auth: { auth: { apiKey: "not-a-jwt" }, source: "oauth" } },
    signal, force: false, fetchFn: async () => Response.json(data),
  });
  assert.equal(additionalOnly.state, "ok");
  assert.match(additionalOnly.summary ?? "", /GPT-5\.4 Mini/);
});

test("Codex rejects non-OAuth credentials and foreign providers without network requests", async () => {
  assert.equal(openAICodexAdapter.canHandle({ providerId: "other", baseUrl: "https://chatgpt.com" }), false);
  let calls = 0;
  const snapshot = await openAICodexAdapter.fetch({
    target: { providerId: "openai-codex", auth: { auth: { apiKey: "api-key" }, source: "config" } },
    signal, force: false, fetchFn: async () => { calls++; return new Response(); },
  });
  assert.equal(snapshot.state, "unauthorized");
  assert.equal(calls, 0);
});

test("deduplication keeps distinct time windows and matches shared Claude pools", () => {
  const windows = deduplicateSharedQuotaGroups([
    { id: "primary-window", label: "5h Window", remainingFraction: 1, resetTime: "2026-09-01T00:00:00Z" },
    { id: "secondary-window", label: "7d Window", remainingFraction: 1, resetTime: "2026-09-01T00:00:00Z" },
  ]);
  assert.equal(windows.length, 2);
  const shared = deduplicateSharedQuotaGroups([
    { id: "thinking-models", remainingFraction: 0.2, resetTime: "2026-09-01T00:00:00Z", models: [{ id: "claude-opus-4-6-thinking" }] },
    { id: "other-models", remainingFraction: 0.2, resetTime: "2026-09-01T00:00:00Z", models: [{ id: "claude-sonnet-4-6" }] },
  ]);
  assert.equal(shared.length, 1);
  assert.equal(matchModelAcrossAccounts([{ provider: "antigravity", rawGroups: shared }], "ag-claude-sonnet-4-6")?.quota.label, "Claude Sonnet");
});

test("proxy matching does not borrow an unrelated account's quota", () => {
  const account = { provider: "antigravity", rawGroups: [{ remainingFraction: 0.5, models: [{ id: "claude-sonnet-4-6" }] }] };
  assert.equal(matchModelAcrossAccounts([account], undefined), undefined);
  assert.equal(isAccountCompatibleWithModel(account, "unrelated-model-1"), false);
  assert.equal(isAccountRelevantToModels(account, ["gemini-3-flash"]), false);
});

test("CPA filters unrelated accounts but preserves Codex model-independent windows", async () => {
  const body = await fixture("pi-bridge-usage.json");
  const fetchFn = async () => new Response(body);
  const claude = await cliProxyBridgeAdapter.fetch({
    target: { providerId: "MyCPA", baseUrl: "https://cpa.example.com/v1", auth, configuredModelIds: ["ag-claude-opus-4-6-thinking"] },
    signal, force: false, fetchFn,
  });
  assert.deepEqual(claude.accounts.map((a) => a.provider), ["antigravity"]);
  const codex = await cliProxyBridgeAdapter.fetch({
    target: { providerId: "MyCPA", baseUrl: "https://cpa.example.com/v1", auth, configuredModelIds: ["proxy-gpt-5.4"] },
    signal, force: false, fetchFn,
  });
  assert.deepEqual(codex.accounts.map((a) => a.provider), ["codex"]);
  assert.deepEqual(codex.accounts[0]?.metrics.map((m) => m.label), ["Codex 5h", "Codex 7d"]);
});

test("adapter overrides cannot send another provider's credentials to ChatGPT or a proxy", () => {
  const adapters = [openAICodexAdapter, cliProxyBridgeAdapter];
  const config = { ...DEFAULT_CONFIG, providerOverrides: { custom: "openai-codex" as const, deepseek: "cliproxy-pi-bridge" as const } };
  assert.equal(chooseAdapter({ providerId: "custom", baseUrl: "https://chatgpt.com" }, adapters, config), undefined);
  assert.equal(chooseAdapter({ providerId: "deepseek", baseUrl: "https://cpa.example.com/v1" }, adapters, config), undefined);
});

test("bridge never handles known native providers or their official origins", () => {
  for (const providerId of ["deepseek", "openai-codex", "anthropic", "xai", "glm", "kimi-coding", "openrouter"]) {
    assert.equal(cliProxyBridgeAdapter.canHandle({ providerId, baseUrl: "https://cpa.example.com/v1" }), false);
  }
  assert.equal(cliProxyBridgeAdapter.canHandle({ providerId: "custom", baseUrl: "https://api.kimi.com/coding" }), false);
  assert.equal(cliProxyBridgeAdapter.canHandle({ providerId: "MyCPA", baseUrl: "https://cpa.example.com/v1" }), true);
});

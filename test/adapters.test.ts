import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { piUsageCpaAdapter } from "../src/modules/provider/adapters/pi-usage-cpa.ts";
import { openAICodexAdapter } from "../src/modules/provider/adapters/openai-codex.ts";
import { chooseAdapter, isAccountCompatibleWithModel } from "../src/modules/provider/matching.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

const fixture = async (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const signal = new AbortController().signal;

test("pi-usage-cpa parses explicit Antigravity windows without borrowing another family", async () => {
  const body = await fixture("pi-usage-cpa.json");
  const fetchFn: typeof fetch = async () => new Response(body);
  const target = { providerId: "MyCPA", baseUrl: "https://cpa.example.com/v1", auth: { auth: { apiKey: "synthetic-key" }, source: "config" } };
  const claude = await piUsageCpaAdapter.fetch({ target: { ...target, configuredModelIds: ["ag-claude-opus-test"] }, signal, force: false, fetchFn });
  assert.equal(claude.state, "ok");
  assert.deepEqual(claude.accounts[0]?.metrics.map((m) => m.id), ["claude-gpt-5h", "claude-gpt-7d"]);
  assert.equal(isAccountCompatibleWithModel(claude.accounts[0]!, "unrelated-model"), false);
  const gemini = await piUsageCpaAdapter.fetch({ target: { ...target, configuredModelIds: ["ag-gemini-3-flash"] }, signal, force: false, fetchFn });
  assert.deepEqual(gemini.accounts[0]?.metrics.map((m) => m.id), ["gemini-5h", "gemini-7d"]);
});

test("Codex OAuth parses 5h and 7d windows", async () => {
  const snapshot = await openAICodexAdapter.fetch({
    target: { providerId: "openai-codex", baseUrl: "https://chatgpt.com/backend-api", auth: { auth: { apiKey: "mock-token" }, source: "oauth" } },
    signal, force: false, fetchFn: async () => new Response(await fixture("openai-codex-usage.json")),
  });
  assert.equal(snapshot.state, "ok");
  assert.deepEqual(snapshot.accounts[0]?.metrics.map((m) => m.label), ["Codex 5h", "Codex 7d"]);
  assert.match(snapshot.summary ?? "", /^Codex · 5h 99% \(.+\) · 7d 78% \(.+\)$/);
});

test("Codex binds the account header to the resolved OAuth token", async () => {
  const token = (account: string) => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.signature`;
  const seen: string[] = [];
  for (const account of ["account-one", "account-two"]) {
    const snapshot = await openAICodexAdapter.fetch({
      target: { providerId: "openai-codex", auth: { auth: { apiKey: token(account) }, source: "OAuth" } }, signal, force: false,
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
    limit_name: "GPT-5.4 Mini", metered_feature: "gpt-5.4-mini",
    rate_limit: {
      primary_window: { used_percent: 75, limit_window_seconds: 18000, reset_at: 1788008289 },
      secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1788487399 },
    },
  }];
  const target = { providerId: "openai-codex", auth: { auth: { apiKey: "not-a-jwt" }, source: "oauth" } };
  const snapshot = await openAICodexAdapter.fetch({ target, signal, force: false, fetchFn: async (_url, init) => {
    assert.equal(new Headers(init?.headers).has("ChatGPT-Account-Id"), false);
    return Response.json(data);
  } });
  assert.equal(snapshot.state, "ok");
  assert.deepEqual(snapshot.accounts[0]?.metrics.map((m) => m.label), ["Codex 5h", "Codex 7d", "GPT-5.4 Mini · 5h", "GPT-5.4 Mini · 7d"]);
  assert.doesNotMatch(snapshot.summary ?? "", /Mini/);
  assert.deepEqual(snapshot.accounts[0]?.metrics.slice(2).map((m) => m.remainingFraction), [0.25, 0.6]);
  delete data.rate_limit;
  const additionalOnly = await openAICodexAdapter.fetch({ target, signal, force: false, fetchFn: async () => Response.json(data) });
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

test("adapter overrides cannot send another provider's credentials across origins", () => {
  const adapters = [openAICodexAdapter, piUsageCpaAdapter];
  const config = { ...DEFAULT_CONFIG, providerOverrides: { custom: "openai-codex" as const, deepseek: "pi-usage-cpa" as const } };
  assert.equal(chooseAdapter({ providerId: "custom", baseUrl: "https://chatgpt.com" }, adapters, config), undefined);
  assert.equal(chooseAdapter({ providerId: "deepseek", baseUrl: "https://cpa.example.com/v1" }, adapters, config), undefined);
});

test("pi-usage-cpa never handles native providers or their official origins", () => {
  for (const providerId of ["deepseek", "openai-codex", "anthropic", "xai", "glm", "kimi-coding", "openrouter"]) {
    assert.equal(piUsageCpaAdapter.canHandle({ providerId, baseUrl: "https://cpa.example.com/v1" }), false);
  }
  assert.equal(piUsageCpaAdapter.canHandle({ providerId: "custom", baseUrl: "https://api.kimi.com/coding" }), false);
  assert.equal(piUsageCpaAdapter.canHandle({ providerId: "MyCPA", baseUrl: "https://cpa.example.com/v1", auth: { auth: { baseUrl: "https://api.kimi.com/coding", apiKey: "secret" } } as any }), false);
  assert.equal(piUsageCpaAdapter.canHandle({ providerId: "MyCPA", baseUrl: "https://cpa.example.com/v1" }), true);
});

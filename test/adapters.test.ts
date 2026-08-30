import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deepSeekAdapter } from "../src/modules/provider/adapters/deepseek.ts";
import { cliProxyBridgeAdapter } from "../src/modules/provider/adapters/cliproxy-pi-bridge.ts";
import { openAICodexAdapter } from "../src/modules/provider/adapters/openai-codex.ts";
import { xaiAdapter } from "../src/modules/provider/adapters/xai.ts";
import { anthropicAdapter } from "../src/modules/provider/adapters/anthropic.ts";
import { glmAdapter } from "../src/modules/provider/adapters/glm.ts";
import { openRouterAdapter } from "../src/modules/provider/adapters/openrouter.ts";
import { openCodeGoAdapter } from "../src/modules/provider/adapters/opencode-go.ts";
import { kimiCodingAdapter } from "../src/modules/provider/adapters/kimi-coding.ts";
import { matchModelAcrossAccounts, matchModelGroup, isAccountRelevantToModels } from "../src/modules/provider/matching.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

const fixture = async (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function auth(apiKey = "sk-test") { return { auth: { apiKey }, source: "test" }; }

test("DeepSeek parses official balances", async () => {
  const body = await fixture("deepseek-balance.json");
  const snapshot = await deepSeekAdapter.fetch({
    target: { providerId: "deepseek", baseUrl: "https://api.deepseek.com", auth: auth() },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.accounts[0]?.metrics[0]?.kind, "balance");
  assert.equal(snapshot.summary, "Balance ¥23.41");
});

test("pi-bridge parses quota windows (group-level only, no model duplicates)", async () => {
  const body = await fixture("pi-bridge-usage.json");
  const snapshot = await cliProxyBridgeAdapter.fetch({
    target: { providerId: "custom-gateway", baseUrl: "https://cpa.example.com/v1", auth: auth() },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.accounts.length, 2);
  const antigravity = snapshot.accounts.find((a) => a.provider === "antigravity");
  assert.ok(antigravity, "antigravity account present");
  // pro-models and flash-models share the exact same quota pool, so they are deduplicated into 1
  assert.equal(antigravity?.metrics.length, 2);
  assert.equal(antigravity?.metrics[1]?.label, "Gemini");
  const codex = snapshot.accounts.find((a) => a.provider === "codex");
  assert.ok(codex, "codex account present");
  assert.equal(codex?.metrics.length, 2);
});

test("pi-bridge missing endpoint is not reported as zero quota", async () => {
  const snapshot = await cliProxyBridgeAdapter.fetch({
    target: { providerId: "custom-gateway", baseUrl: "https://cpa.example.com/v1", auth: auth() },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => new Response("not found", { status: 404 }),
  });
  assert.equal(snapshot.state, "not-installed");
  assert.equal(snapshot.accounts.length, 0);
});

test("openai-codex adapter parses official wham usage response", async () => {
  const body = await fixture("openai-codex-usage.json");
  const snapshot = await openAICodexAdapter.fetch({
    target: {
      providerId: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      auth: { auth: { apiKey: "mock-token" }, source: "oauth" },
    },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.accounts.length, 1);
  const metrics = snapshot.accounts[0]?.metrics ?? [];
  assert.equal(metrics.length, 2);
  assert.equal(metrics[0]?.label, "Codex 5h");
  assert.equal(Math.round((metrics[0] as any).remainingFraction * 100), 99);
  assert.equal(metrics[1]?.label, "Codex 7d");
  assert.equal(Math.round((metrics[1] as any).remainingFraction * 100), 78);
});

test("xai adapter verifies userinfo and parses active status", async () => {
  const body = await fixture("xai-userinfo.json");
  const snapshot = await xaiAdapter.fetch({
    target: {
      providerId: "xai",
      baseUrl: "https://api.x.ai/v1",
      auth: { auth: { apiKey: "mock-xai-token" }, source: "oauth" },
    },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async (url) => {
      if (String(url).includes("chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.summary, "Grok · Active");
  assert.equal(snapshot.accounts[0]?.label, "alex@example.com");
});

test("anthropic adapter handles ratelimit headers and subscription status", async () => {
  const snapshot = await anthropicAdapter.fetch({
    target: {
      providerId: "anthropic",
      baseUrl: "https://api.anthropic.com",
      auth: { auth: { apiKey: "mock-anthropic-token" }, source: "oauth" },
    },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          "anthropic-ratelimit-requests-remaining": "40",
          "anthropic-ratelimit-requests-limit": "50",
          "anthropic-ratelimit-tokens-remaining": "80000",
          "anthropic-ratelimit-tokens-limit": "100000",
        },
      });
    },
  });
  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.summary, "Claude 80%");
  assert.equal(snapshot.accounts[0]?.metrics.length, 3);
});

test("glm adapter parses coding plan multi-window quota correctly", async () => {
  const mockPlanResponse = {
    code: 200,
    success: true,
    data: {
      level: "pro",
      limits: [
        { type: "TOKENS_LIMIT", percentage: 25, nextResetTime: Date.now() + 18000000 },
        { type: "TOKENS_LIMIT", percentage: 50, nextResetTime: Date.now() + 604800000 },
        { type: "TIME_LIMIT", usage: 1000, currentValue: 100, remaining: 900 },
      ],
    },
  };

  const planSnapshot = await glmAdapter.fetch({
    target: {
      providerId: "zai-coding-cn",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      auth: { auth: { apiKey: "mock.glm.key" }, source: "config" },
    },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async (url) => {
      if (String(url).includes("quota/limit")) {
        return new Response(JSON.stringify(mockPlanResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  assert.equal(planSnapshot.state, "ok");
  assert.equal(planSnapshot.summary, "GLM 5h 75% · 7d 50%");
  assert.equal(planSnapshot.accounts[0]?.label, "GLM PRO");
});

test("universal matching works with arbitrary user prefixes and arbitrary provider names", () => {
  const sampleAccounts = [
    {
      provider: "antigravity",
      label: "User Antigravity",
      rawGroups: [
        {
          id: "pro-models",
          label: "Pro Models",
          remainingFraction: 1.0,
          models: [{ id: "gemini-2.5-pro" }, { id: "gemini-3.1-pro-high" }],
        },
        {
          id: "flash-models",
          label: "Flash Models",
          remainingFraction: 0.85,
          models: [{ id: "gemini-2.5-flash" }, { id: "gemini-3.7-flash-tiered" }],
        },
        {
          id: "thinking-models",
          label: "Thinking Models",
          remainingFraction: 0.607,
          models: [{ id: "claude-opus-4-6-thinking" }],
        },
        {
          id: "other-models",
          label: "Other Models",
          remainingFraction: 0.45,
          models: [{ id: "claude-sonnet-4-6" }, { id: "gpt-oss-120b-medium" }],
        },
      ],
    },
    {
      provider: "codex",
      label: "User Codex",
      rawGroups: [
        {
          id: "primary-window",
          label: "5h Window",
          remainingFraction: 0.99,
          models: [{ id: "primary-window" }],
        },
        {
          id: "secondary-window",
          label: "7d Window",
          remainingFraction: 0.77,
          models: [{ id: "secondary-window" }],
        },
      ],
    },
  ];

  // Case 1: Arbitrary prefix "my-custom-flash" (Single group only, never duplicated)
  const m1 = matchModelAcrossAccounts(sampleAccounts, "my-gemini-3.7-flash-tiered");
  assert.ok(m1);
  assert.equal(m1.quota.label, "Gemini Flash");
  assert.equal(Math.round(m1.quota.remainingFraction * 100), 85);
  assert.equal(m1.quota.multiWindows, undefined);

  // Case 2: No prefix at all "claude-opus-4-6-thinking"
  const m2 = matchModelAcrossAccounts(sampleAccounts, "claude-opus-4-6-thinking");
  assert.ok(m2);
  assert.equal(m2.quota.label, "Claude Opus");
  assert.equal(Math.round(m2.quota.remainingFraction * 100), 61);

  // Case 3: Totally different user prefix "corp_claude-sonnet-4-6"
  const m3 = matchModelAcrossAccounts(sampleAccounts, "corp_claude-sonnet-4-6");
  assert.ok(m3);
  assert.equal(m3.quota.label, "Claude Sonnet");
  assert.equal(Math.round(m3.quota.remainingFraction * 100), 45);

  // Case 4: Codex model "custom-codex-gpt-5" (Multiple time windows: 5h and 7d)
  const m4 = matchModelAcrossAccounts(sampleAccounts, "custom-codex-gpt-5");
  assert.ok(m4);
  assert.equal(m4.quota.label, "Codex 5h");
  assert.equal(m4.quota.multiWindows?.length, 2);
  assert.equal(Math.round(m4.quota.multiWindows[0]!.remainingFraction * 100), 99);
  assert.equal(Math.round(m4.quota.multiWindows[1]!.remainingFraction * 100), 77);
});

test("isAccountRelevantToModels filters out unused proxy accounts according to user configured models", () => {
  const antigravityAccount = {
    provider: "antigravity",
    rawGroups: [
      {
        id: "thinking-models",
        label: "Thinking Models",
        models: [{ id: "claude-opus-4-6-thinking" }],
      },
      {
        id: "flash-models",
        label: "Flash Models",
        models: [{ id: "gemini-3.7-flash" }],
      },
    ],
  };

  const codexAccount = {
    provider: "codex",
    rawGroups: [
      {
        id: "primary-window",
        label: "5h Window",
        models: [{ id: "primary-window" }],
      },
    ],
  };

  // User only configured Claude and Gemini under MyCPA
  const configuredModels = ["ag-claude-opus-4-6-thinking", "ag-gemini-3.7-flash-high"];

  assert.equal(isAccountRelevantToModels(antigravityAccount, configuredModels), true);
  assert.equal(isAccountRelevantToModels(codexAccount, configuredModels), false);

  // If user also adds a codex model, codexAccount becomes relevant
  assert.equal(isAccountRelevantToModels(codexAccount, [...configuredModels, "ag-codex"]), true);

  // If user didn't configure explicit models (empty array or undefined), keep all accounts
  assert.equal(isAccountRelevantToModels(codexAccount, []), true);
  assert.equal(isAccountRelevantToModels(codexAccount, undefined), true);
});

test("cliproxy bridge adapter filters accounts when configuredModelIds are supplied", async () => {
  const body = await fixture("pi-bridge-usage.json");
  const snapshot = await cliProxyBridgeAdapter.fetch({
    target: {
      providerId: "MyCPA",
      baseUrl: "https://cpa.example.com/v1",
      auth: auth(),
      configuredModelIds: ["ag-claude-opus-4-6-thinking", "ag-gemini-3.7-flash-high"],
    },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(snapshot.state, "ok");
  // The fixture contains antigravity and codex. Codex should be filtered out!
  assert.equal(snapshot.accounts.length, 1);
  assert.equal(snapshot.accounts[0]?.provider, "antigravity");
});


test("openrouter adapter parses credits", async () => {
  const body = await fixture("openrouter-credits.json");
  const snapshot = await openRouterAdapter.fetch({
    target: { providerId: "openrouter", baseUrl: "https://openrouter.ai/api/v1", auth: auth() },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.displayName, "OpenRouter");
  assert.equal(snapshot.accounts[0]?.metrics[0]?.kind, "balance");
  const bal = snapshot.accounts[0]?.metrics[0] as any;
  assert.equal(bal.amount.toFixed(2), "37.66");
  assert.equal(snapshot.summary, "Balance $37.66");
});

test("opencode-go adapter parses usage windows", async () => {
  const body = await fixture("opencode-go-usage.json");
  const snapshot = await openCodeGoAdapter.fetch({
    target: { providerId: "opencode-go", baseUrl: "https://opencode.ai/api", auth: auth("test-opencode-key") },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.accounts.length, 1);
  assert.equal(snapshot.accounts[0]?.metrics.length, 3);
  const labels = snapshot.accounts[0]?.metrics.map((m:any)=>m.label);
  assert.ok(labels.includes("OpenCode 5h"));
  assert.ok(labels.includes("OpenCode Weekly"));
});

test("new adapters canHandle correctly", () => {
  assert.equal(openRouterAdapter.canHandle({ providerId: "openrouter" }), true);
  assert.equal(openCodeGoAdapter.canHandle({ providerId: "opencode-go" }), true);
  assert.equal(openCodeGoAdapter.canHandle({ providerId: "openrouter", baseUrl: "https://api.siliconflow.cn/v1" }), false);
  assert.equal(openRouterAdapter.canHandle({ providerId: "custom", baseUrl: "https://openrouter.ai/api/v1" }), true);
});
test("cliproxy bridge adapter rejects native providers like deepseek even if baseUrl is present", () => {
  assert.equal(cliProxyBridgeAdapter.canHandle({ providerId: "deepseek", baseUrl: "https://api.deepseek.com" }), false);
  assert.equal(cliProxyBridgeAdapter.canHandle({ providerId: "openai-codex" }), false);
  assert.equal(cliProxyBridgeAdapter.canHandle({ providerId: "anthropic" }), false);
  assert.equal(cliProxyBridgeAdapter.canHandle({ providerId: "xai" }), false);
  assert.equal(cliProxyBridgeAdapter.canHandle({ providerId: "glm" }), false);
});

test("kimi-coding adapter parses 5h and weekly quotas correctly", async () => {
  const mockResponse = {
    usage: {
      limit: "2048",
      used: "204",
      remaining: "1844",
      resetTime: "2026-09-05T12:00:00Z"
    },
    limits: [
      {
        window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
        detail: {
          limit: "200",
          used: "20",
          remaining: "180",
          resetTime: "2026-08-30T15:00:00Z"
        }
      }
    ]
  };

  const snapshot = await kimiCodingAdapter.fetch({
    target: {
      providerId: "kimi-coding",
      baseUrl: "https://api.kimi.com/coding",
      auth: { auth: { apiKey: "mock-token" }, source: "oauth" },
    },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => new Response(JSON.stringify(mockResponse), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.summary, "Kimi 5h 90% · Weekly 90%");
  assert.equal(snapshot.accounts.length, 1);
  assert.equal(snapshot.accounts[0]?.metrics.length, 2);
});

test("kimi-coding adapter handles 429 quota exhausted gracefully", async () => {
  const errorResponse = {
    code: "resource_exhausted",
    message: "insufficient balance",
    details: [
      {
        debug: {
          localizedMessage: {
            message: "Credits used up."
          }
        }
      }
    ]
  };

  const snapshot = await kimiCodingAdapter.fetch({
    target: {
      providerId: "kimi-coding",
      baseUrl: "https://api.kimi.com/coding",
      auth: { auth: { apiKey: "mock-token" }, source: "oauth" },
    },
    signal: new AbortController().signal,
    force: false,
    fetchFn: async () => new Response(JSON.stringify(errorResponse), { status: 429, headers: { "content-type": "application/json" } }),
  });

  assert.equal(snapshot.state, "ok");
  assert.equal(snapshot.summary, "Kimi · 0% (Credits used up.)");
  assert.equal((snapshot.accounts[0]?.metrics[0] as any)?.remainingFraction, 0);
});

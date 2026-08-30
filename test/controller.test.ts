import type { UsageSnapshot } from "../src/core/types.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ProviderUsageController } from "../src/modules/provider/controller.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

const fixture = async (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("controller.refreshAll correctly isolates model baseUrl and filters proxy accounts", async () => {
  const deepseekBody = await fixture("deepseek-balance.json");
  const bridgeBody = await fixture("pi-bridge-usage.json");
  const codexBody = await fixture("openai-codex-usage.json");

  const requestedUrls: string[] = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const urlStr = String(input);
    requestedUrls.push(urlStr);

    if (urlStr.includes("api.deepseek.com")) {
      return new Response(deepseekBody, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (urlStr.includes("cpa.example.com")) {
      return new Response(bridgeBody, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (urlStr.includes("chatgpt.com")) {
      return new Response(codexBody, { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("Not found", { status: 404 });
  };

  const controller = new ProviderUsageController(DEFAULT_CONFIG, mockFetch);

  // Mock Pi extension context representing the user's real setup
  const activeModel = {
    id: "ag-claude-opus-4-6-thinking",
    provider: "MyCPA",
    baseUrl: "https://cpa.example.com/v1",
  };

  const registeredModels = [
    { id: "ag-claude-opus-4-6-thinking", provider: "MyCPA", baseUrl: "https://cpa.example.com/v1" },
    { id: "ag-gemini-3.7-flash-high", provider: "MyCPA", baseUrl: "https://cpa.example.com/v1" },
    { id: "deepseek-chat", provider: "deepseek" },
    { id: "codex-5", provider: "openai-codex" },
  ];

  const mockContext: any = {
    model: activeModel,
    modelRegistry: {
      getAll: () => registeredModels,
      getAvailable: () => registeredModels,
      getRegisteredProviderIds: () => ["MyCPA"],
      getProvider: (id: string) => {
        if (id === "MyCPA") return { baseUrl: "https://cpa.example.com/v1" };
        return undefined;
      },
      getProviderAuthStatus: (id: string) => {
        if (id === "deepseek") return { configured: true };
        if (id === "openai-codex") return { configured: true };
        return { configured: false };
      },
      getProviderAuth: async (id: string) => {
        if (id === "MyCPA") return { auth: { apiKey: "sk-mycpa" }, source: "models.json" };
        if (id === "deepseek") return { auth: { apiKey: "sk-deepseek" }, source: "auth.json" };
        if (id === "openai-codex") return { auth: { apiKey: "token-codex" }, source: "oauth" };
        return undefined;
      },
    },
  };

  const snapshots = await controller.refreshAll(mockContext, true);

  // 1. Verify DeepSeek request: It MUST go to api.deepseek.com, NOT cpa.example.com!
  assert.ok(requestedUrls.some((u) => u.startsWith("https://api.deepseek.com/user/balance")));
  const dsSnapshot = snapshots.find((s) => s.displayName === "DeepSeek");
  assert.ok(dsSnapshot);
  assert.equal(dsSnapshot.state, "ok");
  assert.equal(dsSnapshot.summary, "Balance ¥23.41");

  // 2. Verify MyCPA snapshot: The upstream Codex account must be pruned!
  const cpaSnapshot = snapshots.find((s) => s.displayName === "MyCPA");
  assert.ok(cpaSnapshot);
  assert.equal(cpaSnapshot.state, "ok");
  assert.equal(cpaSnapshot.accounts.length, 1);
  assert.equal(cpaSnapshot.accounts[0]?.provider, "antigravity");
  assert.equal(cpaSnapshot.accounts.some((a) => a.provider === "codex"), false);
  // Shared pool pro/flash are deduplicated!
  assert.equal(cpaSnapshot.accounts[0]?.metrics.length, 2);

  // 3. Verify native OpenAI Codex snapshot: Only 1 official Codex exists
  const codexSnapshot = snapshots.find((s) => s.displayName === "OpenAI Codex");
  assert.ok(codexSnapshot);
  assert.equal(codexSnapshot.state, "ok");
  assert.equal(codexSnapshot.accounts.length, 1);
  assert.equal(codexSnapshot.accounts[0]?.metrics.length, 2);
});

test("controller.currentView does not mismatch foreign quotas to unsupported or different-family models", async () => {
  const controller = new ProviderUsageController(DEFAULT_CONFIG);
  const snapshot: UsageSnapshot = {
    adapterId: "cliproxy-pi-bridge",
    sourceProviderId: "MyCPA",
    displayName: "MyCPA",
    state: "ok",
    fetchedAt: new Date().toISOString(),
    diagnostic: "Unsupported upstream providers: kimi",
    accounts: [
      {
        id: "antigravity-0",
        provider: "antigravity",
        label: "w***@gmail.com",
        metrics: [
          { kind: "quota-window", id: "pro-models", label: "Gemini Pro", remainingFraction: 0.99 },
          { kind: "quota-window", id: "thinking-models", label: "Claude / GPT", remainingFraction: 0.20, resetAt: "2026-08-31T15:58:32Z" }
        ],
        rawGroups: [
          { id: "pro-models", label: "Pro Models", remainingFraction: 0.99, models: [{ id: "gemini-2.5-pro" }] },
          { id: "thinking-models", label: "Thinking Models", remainingFraction: 0.20, models: [{ id: "claude-opus-4-6-thinking" }] }
        ]
      }
    ]
  };

  // 1. Kimi model when upstream proxy marks kimi as unsupported
  const kimiView = controller.currentView({} as any, snapshot, { id: "kimi-k3", provider: "MyCPA" } as any);
  assert.ok(kimiView);
  assert.equal(kimiView.state, "unsupported");
  assert.equal(kimiView.summary, "Kimi · Unsupported by proxy");

  // 2. Claude model correctly matches Claude quota
  const claudeView = controller.currentView({} as any, snapshot, { id: "ag-claude-opus-4-6-thinking", provider: "MyCPA" } as any);
  assert.ok(claudeView);
  assert.equal(claudeView.state, "ok");
  assert.ok(claudeView.summary?.includes("Claude"));

  // 3. Gemini model correctly matches Gemini quota
  const geminiView = controller.currentView({} as any, snapshot, { id: "gemini-2.5-pro", provider: "MyCPA" } as any);
  assert.ok(geminiView);
  assert.equal(geminiView.state, "ok");
  assert.ok(geminiView.summary?.includes("Gemini"));
});

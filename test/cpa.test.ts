import assert from "node:assert/strict";
import test from "node:test";
import { piUsageCpaAdapter } from "../src/modules/provider/adapters/pi-usage-cpa.ts";
import { ProviderUsageController } from "../src/modules/provider/controller.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import type { UsageSnapshot } from "../src/core/types.ts";
import { matchModelAcrossAccounts, type CpaGroup } from "../src/modules/provider/matching.ts";

const groups = [
  { id: "gemini-5h", label: "5h", modelGroup: "gemini" as const, window: "5h", remainingFraction: 0.42, source: "summary" as const },
  { id: "gemini-7d", label: "7d", modelGroup: "gemini" as const, window: "7d", remainingFraction: 0.31, source: "summary" as const },
  { id: "claude-gpt-5h", label: "5h", modelGroup: "claude-gpt" as const, window: "5h", remainingFraction: 0.23, source: "summary" as const },
  { id: "claude-gpt-7d", label: "7d", modelGroup: "claude-gpt" as const, window: "7d", remainingFraction: 0.17, source: "summary" as const },
];
const snapshot = (rawGroups: CpaGroup[] = groups): UsageSnapshot => ({
  adapterId: "pi-usage-cpa", sourceProviderId: "CPA", displayName: "CPA", state: "ok", fetchedAt: "2030-01-01T00:00:00Z",
  accounts: [{ id: "synthetic-opaque", provider: "antigravity", label: "Antigravity 1", metrics: [], rawGroups }],
});
const controller = new ProviderUsageController(DEFAULT_CONFIG);
const view = (s: UsageSnapshot, id: string) => controller.currentView({} as any, s, { id, provider: "CPA" } as any);

test("CPA explicit groups isolate Gemini and shared Claude/GPT windows", () => {
  assert.equal(view(snapshot(), "gemini-pro-test")?.summary, "Gemini Pro · 5h 42% · 7d 31%");
  assert.equal(view(snapshot(), "claude-opus-test")?.summary, "Claude Opus · 5h 23% · 7d 17%");
  assert.equal(view(snapshot(), "gpt-oss-120b")?.summary, "GPT · 5h 23% · 7d 17%");
  assert.equal(view(snapshot(groups.slice(2, 3)), "claude-opus-test")?.summary, "Claude Opus · 5h 23% · 7d unavailable");
  assert.equal(matchModelAcrossAccounts(snapshot().accounts, "unrecognized-test"), undefined);
});

test("CPA multiple accounts never imply a selected route", () => {
  const s = snapshot();
  s.accounts.push({ ...s.accounts[0]!, id: "synthetic-second" });
  assert.equal(view(s, "claude-opus-test")?.summary, "2 accounts · routing account unknown");
  s.accounts[1]!.disabled = true;
  assert.equal(view(s, "claude-opus-test")?.summary, "Claude Opus · 5h 23% · 7d 17%");
});

test("CPA distinguishes Codex GPT from Antigravity GPT-OSS without hiding real account ambiguity", () => {
  const s = snapshot();
  s.accounts[0]!.missingWindows = ["claude-gpt-5h", "claude-gpt-7d"];
  const codex = { id: "synthetic-codex", provider: "codex", label: "Codex", metrics: [], rawGroups: [
    { id: "code-primary", label: "5h", modelGroup: "codex" as const, window: "5h", remainingFraction: 0.69, source: "summary" as const },
    { id: "code-secondary", label: "7d", modelGroup: "codex" as const, window: "7d", remainingFraction: 0.79, source: "summary" as const },
  ] };
  s.accounts.push(codex);
  const gpt = view(s, "gpt-6.1-sol");
  assert.equal(gpt?.summary, "GPT · 5h 69% · 7d 79%");
  assert.deepEqual(gpt?.accounts.map((a) => a.id), ["synthetic-codex"]);
  assert.equal(view(s, "gpt-oss-120b")?.summary, "GPT · 5h 23% · 7d 17%");
  assert.equal(view(s, "ag-gpt-oss-120b")?.accounts[0]?.provider, "antigravity");
  assert.equal(view(s, "claude-sonnet-5-5-high")?.accounts[0]?.provider, "antigravity");
  const missing = snapshot([]);
  missing.accounts[0]!.missingWindows = ["claude-gpt-5h", "claude-gpt-7d"];
  assert.equal(view(missing, "gpt-6.1-sol")?.summary, "No Quota · gpt-6.1-sol");
  assert.match(view(missing, "gpt-oss-120b")?.summary ?? "", /5h unavailable · 7d unavailable/);
  s.accounts.push({ ...codex, id: "synthetic-second-codex" });
  assert.equal(view(s, "gpt-6.1-sol")?.summary, "2 accounts · routing account unknown");
  s.accounts.shift();
  assert.equal(view(s, "gpt-oss-120b")?.summary, "No Quota · gpt-oss-120b");
});

test("CPA does not confuse Antigravity Claude with standalone Claude", () => {
  const s = snapshot();
  s.accounts.push({ id: "synthetic-native-claude", provider: "claude", label: "Claude", metrics: [], rawGroups: [
    { id: "five_hour", label: "5h", modelGroup: "claude", window: "5h", remainingFraction: 0.84, source: "summary" },
    { id: "seven_day_opus", label: "Opus 7d", modelGroup: "claude", window: "7d", remainingFraction: 0.61, source: "summary" },
  ] });
  assert.equal(view(s, "claude-opus-test")?.summary, "2 accounts · routing account unknown");
  assert.equal(view(s, "gemini-pro-test")?.summary, "Gemini Pro · 5h 42% · 7d 31%");
  s.accounts.shift();
  assert.equal(view(s, "claude-opus-test")?.summary, "Claude Opus · 5h 84% · Opus 7d 61%");
  assert.equal(view(s, "claude-sonnet-test")?.summary, "Claude Sonnet · 5h 84%");
});

test("CPA fallback stays model-specific and missing windows remain unavailable", () => {
  const s = snapshot([{ id: "claude-opus-test", label: "Quota (window unknown)", modelGroup: "claude-gpt", window: "", remainingFraction: 0.6, source: "fallback" }]);
  assert.match(view(s, "claude-opus-test")?.summary ?? "", /window unknown · 5h\/7d unavailable/);
  assert.equal(view(s, "claude-sonnet-test")?.summary, "No Quota · claude-sonnet-test");
  const empty = snapshot([]);
  empty.accounts[0]!.missingWindows = ["gemini-5h", "gemini-7d", "claude-gpt-5h", "claude-gpt-7d"];
  assert.match(view(empty, "gemini-pro-test")?.summary ?? "", /5h unavailable · 7d unavailable/);
});

test("CPA errors remain visible instead of being rendered as missing quota", () => {
  const s = snapshot([]);
  s.state = "not-installed";
  assert.equal(view(s, "gemini-pro-test")?.state, "not-installed");
});

test("CPA requests only the new endpoint, including 404, and never retries another plugin", async () => {
  for (const status of [200, 404, 401, 403, 429]) {
    const paths: string[] = [];
    const fetchFn = (async (input: URL, init: RequestInit) => {
      paths.push(input.pathname);
      assert.equal(input.searchParams.get("refresh"), "1");
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer synthetic-client");
      assert.equal((init.headers as Record<string, string>)["X-Pi-Contract"], "2");
      assert.equal(init.redirect, "manual");
      return new Response(status === 200 ? JSON.stringify({ schemaVersion: 1, accounts: [{ provider: "antigravity", groups }] }) : "", { status });
    }) as typeof fetch;
    const request = piUsageCpaAdapter.fetch({ target: { providerId: "CPA", baseUrl: "http://127.0.0.1:8317/v1", configuredModelIds: ["gemini-pro-test"], auth: { auth: { apiKey: "synthetic-client" } } as any }, force: true, signal: AbortSignal.timeout(1000), fetchFn });
    if (status === 429) await assert.rejects(request, /HTTP 429/);
    else {
      const result = await request;
      if (status === 200) assert.equal(result.accounts[0]?.metrics.length, 2);
      else assert.equal(result.state, status === 404 ? "not-installed" : "unauthorized");
    }
    assert.deepEqual(paths, ["/v0/resource/plugins/pi-usage-cpa/usage"]);
  }
});

test("CPA keeps seven providers distinct, including provider-specific windows and unavailable data", async () => {
  const entries: Array<[string, string, string, string, string]> = [
    ["claude", "claude-opus-4", "5h", "five_hour", "Claude Opus · 5h 84%"],
    ["codex", "gpt-5-codex", "7d", "code-secondary", "Codex · 7d 84%"],
    ["kimi", "kimi-k2", "monthly", "monthly", "Kimi · Monthly 84%"],
    ["xai", "grok-4", "7d", "billing-credits", "xAI · 7d 84%"],
    ["devin", "devin-1", "daily", "daily", "Devin · Daily 84%"],
    ["meta", "muse-code", "", "window", "Meta · Quota (window unknown) 84%"],
  ];
  for (const [provider, modelId, window, id, expected] of entries) {
    const label = window === "" ? "Quota (window unknown)" : window === "daily" ? "Daily" : window === "monthly" ? "Monthly" : window;
    const body = { schemaVersion: 1, accounts: [{ provider, authIndex: "synthetic-opaque", label: "Account", groups: [{ id, label, modelGroup: provider, window, remainingFraction: 0.84, source: "summary" }] }] };
    const result = await piUsageCpaAdapter.fetch({ target: { providerId: "CPA", baseUrl: "https://cpa.example.com/v1", configuredModelIds: [modelId], auth: { auth: { apiKey: "synthetic-client" } } as any }, signal: AbortSignal.timeout(1000), force: false, fetchFn: async () => Response.json(body) });
    assert.equal(result.state, "ok", provider);
    assert.equal(view(result, modelId)?.summary, expected);
    assert.equal(view(result, "gemini-test")?.summary, "No Quota · gemini-test");
  }
  const unavailable = { schemaVersion: 1, accounts: [{ provider: "xai", groups: [], error: "quota unavailable" }] };
  const result = await piUsageCpaAdapter.fetch({ target: { providerId: "CPA", baseUrl: "https://cpa.example.com/v1", auth: { auth: { apiKey: "synthetic-client" } } as any }, signal: AbortSignal.timeout(1000), force: false, fetchFn: async () => Response.json(unavailable) });
  assert.equal(result.accounts[0]?.metrics.length, 0);
  assert.equal(view(result, "grok-test")?.summary, "No Quota · grok-test");
});

test("CPA rejects unrelated or legacy-shaped responses instead of inventing quota", async () => {
  const target = { providerId: "CPA", baseUrl: "https://cpa.example.com/v1", auth: { auth: { apiKey: "synthetic-client" }, source: "config" } };
  for (const body of [
    { schemaVersion: 1, accounts: null },
    { schemaVersion: 1, accounts: [{ provider: "antigravity", groups: [{ id: "thinking-models", label: "Thinking Models", remainingFraction: 0.5 }] }] },
    { schemaVersion: 1, accounts: [{ provider: "codex", groups }] },
  ]) {
    const result = await piUsageCpaAdapter.fetch({ target, signal: AbortSignal.timeout(1000), force: false, fetchFn: async () => Response.json(body) });
    assert.equal(result.state, "incompatible");
  }
});

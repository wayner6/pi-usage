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
  assert.equal(view(snapshot(), "gpt-test")?.summary, "GPT · 5h 23% · 7d 17%");
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

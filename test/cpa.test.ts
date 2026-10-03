import assert from "node:assert/strict";
import test from "node:test";
import { cliProxyBridgeAdapter } from "../src/modules/provider/adapters/cliproxy-pi-bridge.ts";
import { ProviderUsageController } from "../src/modules/provider/controller.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import type { UsageSnapshot } from "../src/core/types.ts";
import { deduplicateSharedQuotaGroups, matchModelAcrossAccounts } from "../src/modules/provider/matching.ts";

const groups = [
  { id: "gemini-5h", modelGroup: "gemini", window: "5h", remainingFraction: 0.42, source: "summary" },
  { id: "gemini-7d", modelGroup: "gemini", window: "7d", remainingFraction: 0.31, source: "summary" },
  { id: "claude-gpt-5h", modelGroup: "claude-gpt", window: "5h", remainingFraction: 0.23, source: "summary" },
  { id: "claude-gpt-7d", modelGroup: "claude-gpt", window: "7d", remainingFraction: 0.17, source: "summary" },
];
const snapshot = (rawGroups = groups): UsageSnapshot => ({
  adapterId: "cliproxy-pi-bridge", sourceProviderId: "CPA", displayName: "CPA", state: "ok", fetchedAt: "2030-01-01T00:00:00Z",
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
  const equal = groups.map((g) => ({ ...g, remainingFraction: 0.5, resetTime: "2030-01-01T12:00:00Z" }));
  assert.equal(deduplicateSharedQuotaGroups(equal).length, 4);
});

test("CPA multiple accounts never imply a selected route", () => {
  const s = snapshot();
  s.accounts.push({ ...s.accounts[0]!, id: "synthetic-second" });
  assert.equal(view(s, "claude-opus-test")?.summary, "2 accounts · routing account unknown");
  s.accounts[1]!.disabled = true;
  assert.equal(view(s, "claude-opus-test")?.summary, "Claude Opus · 5h 23% · 7d 17%");
});

test("CPA fallback stays model-specific and unnamed; absent summary stays visible", () => {
  const s = snapshot([{ id: "claude-opus-test", modelGroup: "claude-gpt", window: "", remainingFraction: 0.6, source: "fallback" }]);
  assert.match(view(s, "claude-opus-test")?.summary ?? "", /window unknown · 5h\/7d unavailable/);
  assert.match(view(s, "claude-sonnet-test")?.summary ?? "", /5h unavailable · 7d unavailable/);
  const empty = snapshot([]);
  empty.accounts[0]!.missingWindows = ["gemini-5h", "gemini-7d", "claude-gpt-5h", "claude-gpt-7d"];
  assert.match(view(empty, "gemini-pro-test")?.summary ?? "", /5h unavailable · 7d unavailable/);
});

test("CPA new route first, legacy only on 404; same key and refresh contract", async () => {
  for (const status of [200, 404, 401, 403, 429]) {
    const paths: string[] = [];
    const fetchFn = (async (input: URL, init: RequestInit) => {
      paths.push(input.pathname);
      assert.equal(input.searchParams.get("refresh"), "1");
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer synthetic-client");
      assert.equal((init.headers as Record<string, string>)["X-Pi-Contract"], "2");
      assert.equal(init.redirect, "manual");
      return new Response(JSON.stringify({ schemaVersion: 1, accounts: [{ provider: "antigravity", groups }] }), { status: paths.length === 1 ? status : 200 });
    }) as typeof fetch;
    const request = cliProxyBridgeAdapter.fetch({ target: { providerId: "CPA", baseUrl: "http://127.0.0.1:8317/v1", configuredModelIds: ["gemini-pro-test"], auth: { auth: { apiKey: "synthetic-client" } } as any }, force: true, signal: AbortSignal.timeout(1000), fetchFn });
    if (status === 429) await assert.rejects(request, /HTTP 429/);
    else {
      const s = await request;
      if (status === 200 || status === 404) assert.equal(s.accounts[0]?.metrics.length, 2);
      else assert.equal(s.state, "unauthorized");
    }
    assert.deepEqual(paths, status === 404 ? ["/v0/resource/plugins/pi-usage-cpa/usage", "/v0/resource/plugins/pi-bridge/usage"] : ["/v0/resource/plugins/pi-usage-cpa/usage"]);
  }
});

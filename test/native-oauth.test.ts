import assert from "node:assert/strict";
import test from "node:test";
import { anthropicOAuthAdapter, kimiCodingOAuthAdapter, openRouterOAuthAdapter } from "../src/modules/provider/adapters/native-oauth.ts";
import { ProviderUsageController } from "../src/modules/provider/controller.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

const signal = new AbortController().signal;
const oauth = { auth: { apiKey: "mock-access" }, source: "OAuth" };
const sample = (id: string, baseUrl: string) => ({ providerId: id, baseUrl, auth: oauth });

test("native OAuth usage accepts only matching provider on its official origin", async () => {
  for (const [adapter, id, origin] of [
    [anthropicOAuthAdapter, "anthropic", "https://api.anthropic.com"],
    [kimiCodingOAuthAdapter, "kimi-coding", "https://api.kimi.com"],
    [openRouterOAuthAdapter, "openrouter", "https://openrouter.ai"],
  ] as const) {
    assert.equal(adapter.canHandle(sample(id, `${origin}/v1`)), true);
    assert.equal(adapter.canHandle(sample(id, "https://evil.example/v1")), false);
    assert.equal(adapter.canHandle(sample("other", `${origin}/v1`)), false);
    let called = false;
    const result = await adapter.fetch({ target: { ...sample(id, `${origin}/v1`), auth: { auth: { apiKey: "ordinary-key" }, source: "config" } }, signal, force: false, fetchFn: async () => { called = true; return Response.json({}); } });
    assert.equal(result.state, "unauthorized");
    assert.equal(called, false);
  }
});

test("Claude OAuth shows genuine 5h, 7d and optional Opus windows", async () => {
  const result = await anthropicOAuthAdapter.fetch({
    target: sample("anthropic", "https://api.anthropic.com"), signal, force: false,
    fetchFn: async (url, init) => {
      assert.equal(String(url), "https://api.anthropic.com/api/oauth/usage");
      assert.equal(new Headers(init?.headers).get("anthropic-beta"), "oauth-2025-04-20");
      return Response.json({ five_hour: { utilization: 25, resets_at: "2026-11-01T00:00:00Z" }, seven_day: { utilization: 40 }, seven_day_opus: { utilization: 60 }, seven_day_sonnet: { utilization: null } });
    },
  });
  assert.equal(result.state, "ok");
  assert.deepEqual(result.accounts[0]?.metrics.map((m) => m.remainingFraction), [0.75, 0.6, 0.4]);
  assert.match(result.summary ?? "", /5h 75%.*7d 60%.*Opus 7d 40%/);
});

test("Kimi Code OAuth reports actual week and rolling 5h without inventing missing quota", async () => {
  const target = sample("kimi-coding", "https://api.kimi.com/coding");
  const fetchFn: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://api.kimi.com/coding/v1/usages");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer mock-access");
    return Response.json({ usage: { used: "20", limit: "100", resetTime: "2026-11-06T00:00:00Z" }, limits: [
      { window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { used: "2", limit: "10", resetTime: "2026-11-01T00:00:00Z" } },
      { window: { duration: 60, timeUnit: "TIME_UNIT_MINUTE" }, detail: { used: "5", limit: "10" } },
    ] });
  };
  const result = await kimiCodingOAuthAdapter.fetch({ target, signal, force: false, fetchFn });
  assert.deepEqual(result.accounts[0]?.metrics.map((m) => [m.label, m.remainingFraction]), [["Kimi Code 5h", 0.8], ["Kimi Code 7d", 0.8]]);
  const missing = await kimiCodingOAuthAdapter.fetch({ target, signal, force: false, fetchFn: async () => Response.json({ limits: [{ window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" } }] }) });
  assert.equal(missing.state, "empty");
  const pooled = await kimiCodingOAuthAdapter.fetch({ target, signal, force: false, fetchFn: async () => Response.json({ usages: { limit_5h: { used_ratio: 0, reset_time: "2026-11-01T00:00:00Z" }, limit_7d: { used_ratio: 0.4 } } }) });
  assert.deepEqual(pooled.accounts[0]?.metrics.map((m) => m.remainingFraction), [1, 0.6]);
});

test("OpenRouter OAuth key caps are not mistaken for account credit balance", async () => {
  const target = sample("openrouter", "https://openrouter.ai/api/v1");
  const result = await openRouterOAuthAdapter.fetch({ target, signal, force: false, fetchFn: async () => Response.json({ data: { limit: 100, limit_remaining: 30, free_model_daily_requests: { used: 4, limit: 20, remaining: 16 } } }) });
  assert.deepEqual(result.accounts[0]?.metrics.map((m) => m.remainingFraction), [0.3, 0.8]);
  const unlimited = await openRouterOAuthAdapter.fetch({ target, signal, force: false, fetchFn: async () => Response.json({ data: { limit: null, limit_remaining: null, usage: 25 } }) });
  assert.equal(unlimited.state, "empty");
});

test("native OAuth redirects cannot forward tokens cross-origin and auth failures do not look like zero", async () => {
  const target = sample("anthropic", "https://api.anthropic.com");
  await assert.rejects(anthropicOAuthAdapter.fetch({ target, signal, force: false, fetchFn: async () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }) }), /cross-origin/);
  const denied = await anthropicOAuthAdapter.fetch({ target, signal, force: false, fetchFn: async () => new Response("secret", { status: 401 }) });
  assert.equal(denied.state, "unauthorized");
  assert.doesNotMatch(denied.error ?? "", /secret/);
});

test("Anthropic automatic refresh reuses a recent result; explicit refresh can retry", async () => {
  let calls = 0;
  const controller = new ProviderUsageController(DEFAULT_CONFIG, async () => {
    calls++;
    return Response.json({ five_hour: { utilization: 50 } });
  });
  const target = sample("anthropic", "https://api.anthropic.com");
  await controller.fetchTarget(target);
  await controller.fetchTarget(target);
  assert.equal(calls, 1);
  await controller.fetchTarget(target, true);
  assert.equal(calls, 2);
});

test("controller discovers available native OAuth providers but skips unqueryable OAuth providers", async () => {
  const ids = ["anthropic", "kimi-coding", "openrouter", "github-copilot", "meta", "xai", "radius"];
  const urls: string[] = [];
  const controller = new ProviderUsageController(DEFAULT_CONFIG, async (url) => {
    urls.push(String(url));
    return Response.json({});
  });
  const ctx: any = {
    model: { id: "claude-opus", provider: "anthropic" },
    modelRegistry: {
      getAll: () => ids.map((id) => ({ id: `${id}-model`, provider: id })),
      getAvailable: () => ids.map((id) => ({ id: `${id}-model`, provider: id })),
      getRegisteredProviderIds: () => [],
      getProviderAuthStatus: (id: string) => ({ configured: ids.includes(id) }),
      getProvider: (id: string) => ({ name: id }),
      getProviderAuth: async () => oauth,
    },
  };
  const result = await controller.refreshAll(ctx);
  assert.deepEqual(result.map((s) => s.sourceProviderId).sort(), ["anthropic", "kimi-coding", "openrouter"]);
  assert.equal(urls.length, 3);
});

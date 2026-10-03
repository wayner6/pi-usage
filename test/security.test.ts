import assert from "node:assert/strict";
import test from "node:test";
import { cpaUsageUrl, isUrlOnDomain, sameOriginFetch } from "../src/core/security.ts";

test("official-domain checks reject lookalike hostnames", () => {
  assert.equal(isUrlOnDomain("https://api.openrouter.ai/v1", "openrouter.ai"), true);
  assert.equal(isUrlOnDomain("https://evilopenrouter.ai/v1", "openrouter.ai"), false);
  assert.equal(isUrlOnDomain("://invalid", "openrouter.ai"), false);
});

test("CPA usage URL stays on the configured provider origin", () => {
  assert.equal(cpaUsageUrl("https://cpa.example.com/v1").href, "https://cpa.example.com/v0/resource/plugins/pi-usage-cpa/usage");
  assert.equal(cpaUsageUrl("https://cpa.example.com/v1", true).searchParams.get("refresh"), "1");
});

test("authenticated redirects cannot cross origin", async () => {
  await assert.rejects(() => sameOriginFetch(
    new URL("https://cpa.example.com/start"),
    { headers: { Authorization: "Bearer secret" } },
    async () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }),
    "https://cpa.example.com",
  ), /cross-origin/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { bridgeUrl, redact, sameOriginFetch } from "../src/core/security.ts";

test("bridge URL stays on provider origin", () => {
  assert.equal(bridgeUrl("https://cpa.example.com/v1", "usage").href, "https://cpa.example.com/v0/resource/plugins/pi-bridge/usage");
});

test("authenticated redirects cannot cross origin", async () => {
  await assert.rejects(() => sameOriginFetch(
    new URL("https://cpa.example.com/start"),
    { headers: { Authorization: "Bearer secret" } },
    async () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }),
    "https://cpa.example.com",
  ), /cross-origin/);
});

test("diagnostic objects redact common secret fields", () => {
  assert.deepEqual(redact({ apiKey: "secret", nested: { Authorization: "Bearer secret", ok: 1 } }), { apiKey: "[REDACTED]", nested: { Authorization: "[REDACTED]", ok: 1 } });
});

import assert from "node:assert/strict";
import test from "node:test";
import { UsageCache } from "../src/core/cache.ts";
import type { UsageSnapshot } from "../src/core/types.ts";

const snapshot = (): UsageSnapshot => ({ adapterId: "test", sourceProviderId: "p", displayName: "Test", state: "ok", fetchedAt: new Date().toISOString(), accounts: [] });

test("cache coalesces overlapping refreshes", async () => {
  const cache = new UsageCache();
  let calls = 0;
  const operation = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 5)); return snapshot(); };
  await Promise.all([cache.coalesce("x", operation), cache.coalesce("x", operation)]);
  assert.equal(calls, 1);
});

test("cache preserves old data as stale after failure", async () => {
  const cache = new UsageCache();
  await cache.coalesce("x", async () => snapshot());
  const result = await cache.coalesce("x", async () => { throw new Error("offline"); });
  assert.equal(result.state, "stale");
  assert.equal(result.error, "offline");
});

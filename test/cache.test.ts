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

test("clearing cache isolates pending results and pending request cleanup", async () => {
  const cache = new UsageCache();
  let finishOld!: (value: UsageSnapshot) => void;
  let finishNew!: (value: UsageSnapshot) => void;
  const old = cache.coalesce("x", () => new Promise((resolve) => { finishOld = resolve; }));
  cache.clear();
  const current = cache.coalesce("x", () => new Promise((resolve) => { finishNew = resolve; }));
  finishOld(snapshot());
  await old;
  assert.equal(cache.get("x"), undefined);
  let extraCalls = 0;
  const coalesced = cache.coalesce("x", async () => { extraCalls++; return snapshot(); });
  finishNew(snapshot());
  await Promise.all([current, coalesced]);
  assert.equal(extraCalls, 0);
  assert.equal(cache.get("x")?.state, "ok");
});

test("cache redacts errors for both fresh failures and stale results", async () => {
  const cache = new UsageCache();
  const fail = async (): Promise<UsageSnapshot> => { throw new Error("offline Bearer synthetic-secret sk-synthetic-key"); };
  await assert.rejects(cache.coalesce("x", fail), (error: Error) => {
    assert.doesNotMatch(error.message, /synthetic-secret|synthetic-key/);
    return true;
  });
  await cache.coalesce("x", async () => snapshot());
  const result = await cache.coalesce("x", fail);
  assert.equal(result.state, "stale");
  assert.doesNotMatch(result.error ?? "", /synthetic-secret|synthetic-key/);
});

test("cache preserves old data as stale after failure", async () => {
  const cache = new UsageCache();
  await cache.coalesce("x", async () => snapshot());
  const result = await cache.coalesce("x", async () => { throw new Error("offline"); });
  assert.equal(result.state, "stale");
  assert.equal(result.error, "offline");
});

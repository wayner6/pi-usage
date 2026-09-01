import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { SkillUsageController } from "../src/modules/skills/controller.ts";
import { aggregateSkillEvents, parseSkillUsageLog } from "../src/modules/skills/store.ts";
import type { SkillUsageEvent } from "../src/modules/skills/types.ts";
import { skillStatsLines } from "../src/ui/skills.ts";

function fixture() {
  const skillPath = resolve("test", "skills", "pdf", "SKILL.md");
  const globalEvents: SkillUsageEvent[] = [];
  const pi = {
    getCommands: () => [{
      name: "skill:pdf",
      description: "Work with PDFs",
      source: "skill" as const,
      sourceInfo: { path: skillPath, source: "test", scope: "project" as const, origin: "top-level" as const },
    }],
  };
  const context = { cwd: process.cwd() } as any;
  const controller = new SkillUsageController(
    pi,
    async (event) => { globalEvents.push(event); },
    async () => globalEvents,
  );
  return { controller, context, skillPath, globalEvents };
}

test("skill tracking counts a command and its subsequent entry read once per agent run", async () => {
  const { controller, context, skillPath, globalEvents } = fixture();
  await controller.captureInput("/skill:pdf extract report.pdf", context);
  await controller.beginRun();
  controller.captureReadCall("read-1", skillPath, context);
  await controller.captureReadResult("read-1", false);

  assert.equal(globalEvents.length, 1);
  assert.deepEqual(await controller.globalStats(), [{ skill: "pdf", uses: 1 }]);

  controller.finishRun();
  await controller.beginRun();
  controller.captureReadCall("read-2", skillPath, context);
  await controller.captureReadResult("read-2", false);
  assert.deepEqual(await controller.globalStats(), [{ skill: "pdf", uses: 2 }]);
});

test("failed and foreign entry reads are not counted", async () => {
  const { controller, context, skillPath, globalEvents } = fixture();
  await controller.beginRun();
  controller.captureReadCall("failed", skillPath, context);
  await controller.captureReadResult("failed", true);
  controller.captureReadCall("foreign", resolve("somewhere", "SKILL.md"), context);
  await controller.captureReadResult("foreign", false);
  assert.equal(globalEvents.length, 0);
});

test("skill display includes every installed skill, including zero-use skills", () => {
  const lines = skillStatsLines(["agent-reach", "pdf"], [{ skill: "pdf", uses: 3 }]);
  assert.ok(lines.some((line) => /agent-reach\s+0$/.test(line)));
  assert.ok(lines.some((line) => /pdf\s+3$/.test(line)));
});

test("skill log parser tolerates corrupt lines and honors legacy reset/deduplication records", () => {
  const log = [
    JSON.stringify({ version: 1, kind: "usage", skill: "old", method: "model", activation: true, timestamp: "2026-01-01T00:00:00.000Z" }),
    JSON.stringify({ version: 1, kind: "reset", timestamp: "2026-01-01T00:01:00.000Z" }),
    "{incomplete",
    JSON.stringify({ version: 1, kind: "usage", skill: "pdf", method: "model", activation: false, timestamp: "2026-01-01T00:02:00.000Z" }),
    JSON.stringify({ version: 1, skill: "pdf", timestamp: "2026-01-01T00:03:00.000Z" }),
  ].join("\n");
  assert.deepEqual(parseSkillUsageLog(log), [
    { version: 1, skill: "pdf", timestamp: "2026-01-01T00:03:00.000Z" },
  ]);
});

test("skill event aggregation returns simple usage counts", () => {
  const events: SkillUsageEvent[] = [
    { version: 1, skill: "pdf", timestamp: "2026-01-01T00:00:00.000Z" },
    { version: 1, skill: "pdf", timestamp: "2026-01-01T00:01:00.000Z" },
    { version: 1, skill: "agent-reach", timestamp: "2026-01-01T00:02:00.000Z" },
  ];
  assert.deepEqual(aggregateSkillEvents(events), [
    { skill: "pdf", uses: 2 },
    { skill: "agent-reach", uses: 1 },
  ]);
});

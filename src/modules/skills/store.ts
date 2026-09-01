import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SkillUsageEvent, SkillUsageStats } from "./types.ts";

export function skillUsagePath(): string {
  return join(getAgentDir(), "pi-usage", "skill-usage.jsonl");
}

export function isSkillUsageEvent(value: unknown): value is SkillUsageEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<SkillUsageEvent>;
  return event.version === 1
    && typeof event.skill === "string"
    && event.skill.trim().length > 0
    && typeof event.timestamp === "string"
    && Number.isFinite(Date.parse(event.timestamp));
}

export function aggregateSkillEvents(events: Iterable<SkillUsageEvent>): SkillUsageStats[] {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.skill, (counts.get(event.skill) ?? 0) + 1);
  return [...counts].map(([skill, uses]) => ({ skill, uses }));
}

export async function appendGlobalSkillEvent(event: SkillUsageEvent): Promise<void> {
  const path = skillUsagePath();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

export function parseSkillUsageLog(content: string): SkillUsageEvent[] {
  const events: SkillUsageEvent[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object" && (value as { kind?: unknown }).kind === "reset") {
        events.length = 0;
      } else if (
        isSkillUsageEvent(value)
        && (value as SkillUsageEvent & { activation?: boolean }).activation !== false
      ) {
        events.push(value);
      }
    } catch {
      // Ignore an incomplete or corrupt JSONL line; later valid records remain usable.
    }
  }
  return events;
}

export async function loadGlobalSkillEvents(): Promise<SkillUsageEvent[]> {
  try {
    return parseSkillUsageLog(await readFile(skillUsagePath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

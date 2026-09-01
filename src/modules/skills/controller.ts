import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SkillCatalog } from "./catalog.ts";
import { aggregateSkillEvents, appendGlobalSkillEvent, loadGlobalSkillEvents } from "./store.ts";
import type { SkillDescriptor, SkillUsageEvent, SkillUsageStats } from "./types.ts";

export class SkillUsageController {
  private readonly catalog = new SkillCatalog();
  private readonly pendingReads = new Map<string, SkillDescriptor>();
  private readonly queuedCommands = new Map<string, SkillDescriptor>();
  private readonly usedThisRun = new Set<string>();
  private readonly pi: Pick<ExtensionAPI, "getCommands">;
  private readonly writeGlobal: (event: SkillUsageEvent) => Promise<void>;
  private readonly readGlobal: () => Promise<SkillUsageEvent[]>;
  private runActive = false;
  private globalWriteTail: Promise<void> = Promise.resolve();

  constructor(
    pi: Pick<ExtensionAPI, "getCommands">,
    writeGlobal: (event: SkillUsageEvent) => Promise<void> = appendGlobalSkillEvent,
    readGlobal: () => Promise<SkillUsageEvent[]> = loadGlobalSkillEvents,
  ) {
    this.pi = pi;
    this.writeGlobal = writeGlobal;
    this.readGlobal = readGlobal;
  }

  refreshCatalog(cwd: string): void {
    this.catalog.refresh(this.pi, cwd);
  }

  async captureInput(text: string, ctx: ExtensionContext): Promise<void> {
    this.refreshCatalog(ctx.cwd);
    const skill = this.catalog.matchCommand(text);
    if (!skill) return;
    if (this.runActive) await this.recordUsage(skill.name);
    else this.queuedCommands.set(skill.name, skill);
  }

  async beginRun(): Promise<void> {
    this.runActive = true;
    this.usedThisRun.clear();
    const commands = [...this.queuedCommands.values()];
    this.queuedCommands.clear();
    for (const skill of commands) await this.recordUsage(skill.name);
  }

  finishRun(): void {
    this.runActive = false;
    this.usedThisRun.clear();
    this.pendingReads.clear();
    this.queuedCommands.clear();
  }

  captureReadCall(toolCallId: string, path: string, ctx: ExtensionContext): void {
    this.refreshCatalog(ctx.cwd);
    const skill = this.catalog.matchRead(path, ctx.cwd);
    if (skill) this.pendingReads.set(toolCallId, skill);
  }

  async captureReadResult(toolCallId: string, isError: boolean): Promise<void> {
    const skill = this.pendingReads.get(toolCallId);
    this.pendingReads.delete(toolCallId);
    if (skill && !isError) await this.recordUsage(skill.name);
  }

  installedSkills(cwd: string): string[] {
    this.refreshCatalog(cwd);
    return this.catalog.installedNames();
  }

  async globalStats(): Promise<SkillUsageStats[]> {
    return aggregateSkillEvents(await this.readGlobal());
  }

  private async recordUsage(skill: string): Promise<void> {
    if (this.usedThisRun.has(skill)) return;
    this.usedThisRun.add(skill);
    const event: SkillUsageEvent = { version: 1, skill, timestamp: new Date().toISOString() };
    const operation = this.globalWriteTail.then(() => this.writeGlobal(event));
    this.globalWriteTail = operation.catch(() => undefined);
    await operation;
  }
}

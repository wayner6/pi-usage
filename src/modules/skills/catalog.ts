import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename, isAbsolute, join, normalize, resolve } from "node:path";
import type { SkillDescriptor } from "./types.ts";

function normalizedPath(path: string, cwd: string): string {
  const withoutAt = path.startsWith("@") ? path.slice(1) : path;
  const absolute = isAbsolute(withoutAt) ? withoutAt : resolve(cwd, withoutAt);
  const value = normalize(absolute).replaceAll("\\", "/").replace(/\/$/, "");
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function sourceCandidates(path: string, baseDir: string | undefined, cwd: string): string[] {
  const root = baseDir ?? cwd;
  const source = normalizedPath(path, root);
  const candidates = [source];
  if (basename(source).toLowerCase() !== "skill.md" && !source.toLowerCase().endsWith(".md")) {
    candidates.push(normalizedPath(join(path, "SKILL.md"), root));
  }
  return candidates;
}

export class SkillCatalog {
  private byCommand = new Map<string, SkillDescriptor>();
  private byPath = new Map<string, SkillDescriptor>();

  refresh(pi: Pick<ExtensionAPI, "getCommands">, cwd: string): void {
    this.byCommand.clear();
    this.byPath.clear();

    for (const command of pi.getCommands()) {
      if (command.source !== "skill" || !command.name.startsWith("skill:")) continue;
      const descriptor: SkillDescriptor = { name: command.name.slice("skill:".length) };
      this.byCommand.set(command.name, descriptor);
      for (const candidate of sourceCandidates(command.sourceInfo.path, command.sourceInfo.baseDir, cwd)) {
        this.byPath.set(candidate, descriptor);
      }
    }
  }

  installedNames(): string[] {
    return [...this.byCommand.values()].map((skill) => skill.name).sort((a, b) => a.localeCompare(b));
  }

  matchExpandedPrompt(text: string, cwd: string): SkillDescriptor | undefined {
    const match = /^<skill name="([^"\n]+)" location="([^"\n]+)">\r?\n/.exec(text);
    if (!match) return undefined;
    const skill = this.byCommand.get(`skill:${match[1]}`);
    return skill?.name === this.byPath.get(normalizedPath(match[2]!, cwd))?.name ? skill : undefined;
  }

  matchRead(path: string, cwd: string): SkillDescriptor | undefined {
    return this.byPath.get(normalizedPath(path, cwd));
  }
}

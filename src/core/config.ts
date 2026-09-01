import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface UsageConfig {
  display: { status: boolean; widget: boolean; detailsDefault: "all" | "current" };
  refresh: { intervalSeconds: number; timeoutSeconds: number };
  skills: { enabled: boolean };
  adapters: {
    deepseek: { enabled: boolean };
    cliproxyPiBridge: { enabled: boolean };
    openaiCodex: { enabled: boolean };
    xai: { enabled: boolean };
    anthropic: { enabled: boolean };
    glm: { enabled: boolean };
    openrouter: { enabled: boolean };
    opencodeGo: { enabled: boolean };
    kimiCoding: { enabled: boolean };
  };
  providerOverrides: Record<string, "deepseek" | "cliproxy-pi-bridge" | "openai-codex" | "xai" | "anthropic" | "glm" | "openrouter" | "opencode-go" | "kimi-coding" | "disabled">;
}

export const DEFAULT_CONFIG: UsageConfig = {
  display: { status: true, widget: false, detailsDefault: "all" },
  refresh: { intervalSeconds: 120, timeoutSeconds: 10 },
  skills: { enabled: true },
  adapters: {
    deepseek: { enabled: true },
    cliproxyPiBridge: { enabled: true },
    openaiCodex: { enabled: true },
    xai: { enabled: true },
    anthropic: { enabled: true },
    glm: { enabled: true },
    openrouter: { enabled: true },
    opencodeGo: { enabled: true },
    kimiCoding: { enabled: true },
  },
  providerOverrides: {},
};

export function configPath(): string {
  return join(getAgentDir(), "pi-usage", "config.json");
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function providerOverrides(value: unknown): UsageConfig["providerOverrides"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set([
    "deepseek", "cliproxy-pi-bridge", "openai-codex", "xai", "anthropic",
    "glm", "openrouter", "opencode-go", "kimi-coding", "disabled",
  ]);
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, UsageConfig["providerOverrides"][string]] =>
      typeof entry[1] === "string" && allowed.has(entry[1])),
  );
}

export async function loadConfig(): Promise<UsageConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UsageConfig>;
    return {
      display: {
        status: boolean(parsed.display?.status, DEFAULT_CONFIG.display.status),
        widget: boolean(parsed.display?.widget, DEFAULT_CONFIG.display.widget),
        detailsDefault: parsed.display?.detailsDefault === "current" ? "current" : "all",
      },
      refresh: {
        intervalSeconds: clamp(parsed.refresh?.intervalSeconds, 30, 3600, DEFAULT_CONFIG.refresh.intervalSeconds),
        timeoutSeconds: clamp(parsed.refresh?.timeoutSeconds, 2, 60, DEFAULT_CONFIG.refresh.timeoutSeconds),
      },
      skills: { enabled: boolean(parsed.skills?.enabled, DEFAULT_CONFIG.skills.enabled) },
      adapters: {
        deepseek: { enabled: boolean(parsed.adapters?.deepseek?.enabled, DEFAULT_CONFIG.adapters.deepseek.enabled) },
        cliproxyPiBridge: { enabled: boolean(parsed.adapters?.cliproxyPiBridge?.enabled, DEFAULT_CONFIG.adapters.cliproxyPiBridge.enabled) },
        openaiCodex: { enabled: boolean(parsed.adapters?.openaiCodex?.enabled, DEFAULT_CONFIG.adapters.openaiCodex.enabled) },
        xai: { enabled: boolean(parsed.adapters?.xai?.enabled, DEFAULT_CONFIG.adapters.xai.enabled) },
        anthropic: { enabled: boolean(parsed.adapters?.anthropic?.enabled, DEFAULT_CONFIG.adapters.anthropic.enabled) },
        glm: { enabled: boolean(parsed.adapters?.glm?.enabled, DEFAULT_CONFIG.adapters.glm.enabled) },
        openrouter: { enabled: boolean(parsed.adapters?.openrouter?.enabled, DEFAULT_CONFIG.adapters.openrouter.enabled) },
        opencodeGo: { enabled: boolean(parsed.adapters?.opencodeGo?.enabled, DEFAULT_CONFIG.adapters.opencodeGo.enabled) },
        kimiCoding: { enabled: boolean(parsed.adapters?.kimiCoding?.enabled, DEFAULT_CONFIG.adapters.kimiCoding.enabled) },
      },
      providerOverrides: providerOverrides(parsed.providerOverrides),
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export async function saveConfig(config: UsageConfig): Promise<void> {
  const file = configPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

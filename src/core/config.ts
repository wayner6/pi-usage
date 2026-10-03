import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface UsageConfig {
  display: { status: boolean; widget: boolean; detailsDefault: "all" | "current" };
  refresh: { intervalSeconds: number; timeoutSeconds: number };
  skills: { enabled: boolean };
  adapters: {
    cliproxyPiBridge: { enabled: boolean };
    openaiCodex: { enabled: boolean };
    nativeOAuth: { enabled: boolean };
  };
  providerOverrides: Record<string, "cliproxy-pi-bridge" | "openai-codex" | "anthropic" | "kimi-coding" | "openrouter" | "disabled">;
}

export const DEFAULT_CONFIG: UsageConfig = {
  display: { status: true, widget: false, detailsDefault: "all" },
  refresh: { intervalSeconds: 120, timeoutSeconds: 10 },
  skills: { enabled: true },
  adapters: {
    cliproxyPiBridge: { enabled: true },
    openaiCodex: { enabled: true },
    nativeOAuth: { enabled: true },
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
    "cliproxy-pi-bridge", "openai-codex", "anthropic", "kimi-coding", "openrouter", "disabled",
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
        cliproxyPiBridge: { enabled: boolean(parsed.adapters?.cliproxyPiBridge?.enabled, DEFAULT_CONFIG.adapters.cliproxyPiBridge.enabled) },
        openaiCodex: { enabled: boolean(parsed.adapters?.openaiCodex?.enabled, DEFAULT_CONFIG.adapters.openaiCodex.enabled) },
        nativeOAuth: { enabled: boolean(parsed.adapters?.nativeOAuth?.enabled, DEFAULT_CONFIG.adapters.nativeOAuth.enabled) },
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

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface UsageConfig {
  display: { status: boolean; widget: boolean; detailsDefault: "all" | "current" };
  refresh: { intervalSeconds: number; timeoutSeconds: number };
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
  modelMappings: Array<{ provider: string; modelPattern: string; quotaProvider: string }>;
}

export const DEFAULT_CONFIG: UsageConfig = {
  display: { status: true, widget: false, detailsDefault: "all" },
  refresh: { intervalSeconds: 120, timeoutSeconds: 10 },
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
  modelMappings: [],
};

export function configPath(): string {
  return join(getAgentDir(), "pi-usage", "config.json");
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export async function loadConfig(): Promise<UsageConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UsageConfig>;
    return {
      display: {
        status: parsed.display?.status ?? DEFAULT_CONFIG.display.status,
        widget: parsed.display?.widget ?? DEFAULT_CONFIG.display.widget,
        detailsDefault: parsed.display?.detailsDefault === "current" ? "current" : "all",
      },
      refresh: {
        intervalSeconds: clamp(parsed.refresh?.intervalSeconds, 10, 86400, DEFAULT_CONFIG.refresh.intervalSeconds),
        timeoutSeconds: clamp(parsed.refresh?.timeoutSeconds, 2, 60, DEFAULT_CONFIG.refresh.timeoutSeconds),
      },
      adapters: {
        deepseek: { enabled: parsed.adapters?.deepseek?.enabled ?? DEFAULT_CONFIG.adapters.deepseek.enabled },
        cliproxyPiBridge: { enabled: parsed.adapters?.cliproxyPiBridge?.enabled ?? DEFAULT_CONFIG.adapters.cliproxyPiBridge.enabled },
        openaiCodex: { enabled: parsed.adapters?.openaiCodex?.enabled ?? DEFAULT_CONFIG.adapters.openaiCodex.enabled },
        xai: { enabled: parsed.adapters?.xai?.enabled ?? DEFAULT_CONFIG.adapters.xai.enabled },
        anthropic: { enabled: parsed.adapters?.anthropic?.enabled ?? DEFAULT_CONFIG.adapters.anthropic.enabled },
        glm: { enabled: parsed.adapters?.glm?.enabled ?? DEFAULT_CONFIG.adapters.glm.enabled },
        openrouter: { enabled: (parsed.adapters as any)?.openrouter?.enabled ?? DEFAULT_CONFIG.adapters.openrouter.enabled },
        opencodeGo: { enabled: parsed.adapters?.opencodeGo?.enabled ?? DEFAULT_CONFIG.adapters.opencodeGo.enabled },
        kimiCoding: { enabled: parsed.adapters?.kimiCoding?.enabled ?? DEFAULT_CONFIG.adapters.kimiCoding.enabled },
      },
      providerOverrides: parsed.providerOverrides ?? {},
      modelMappings: Array.isArray(parsed.modelMappings) ? parsed.modelMappings : [],
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: UsageConfig): Promise<void> {
  const file = configPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

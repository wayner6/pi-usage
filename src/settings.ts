import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { UsageConfig } from "./core/config.ts";
import { configPath, saveConfig } from "./core/config.ts";

export async function handleSettings(args: string, ctx: ExtensionCommandContext, config: UsageConfig): Promise<UsageConfig> {
  const [key, value] = args.trim().split(/\s+/);
  const next = structuredClone(config);
  if (!key) {
    ctx.ui.notify(`Config: ${configPath()}\nstatus=${next.display.status} widget=${next.display.widget} interval=${next.refresh.intervalSeconds}s timeout=${next.refresh.timeoutSeconds}s`, "info");
    return next;
  }
  if (key === "widget" && /^(on|off)$/.test(value ?? "")) next.display.widget = value === "on";
  else if (key === "status" && /^(on|off)$/.test(value ?? "")) next.display.status = value === "on";
  else if (key === "interval" && Number.isFinite(Number(value))) next.refresh.intervalSeconds = Math.min(3600, Math.max(30, Number(value)));
  else if (key === "timeout" && Number.isFinite(Number(value))) next.refresh.timeoutSeconds = Math.min(60, Math.max(2, Number(value)));
  else {
    ctx.ui.notify("Usage: /usage settings [widget|status] [on|off], or interval/timeout <seconds>", "warning");
    return config;
  }
  await saveConfig(next);
  ctx.ui.notify(`Pi Usage settings saved to ${configPath()}`, "info");
  return next;
}

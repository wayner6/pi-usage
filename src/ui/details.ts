import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, Text, matchesKey } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { UsageSnapshot } from "../core/types.ts";
import { snapshotLines } from "./format.ts";

export async function showDetails(ctx: ExtensionCommandContext, snapshots: UsageSnapshot[]): Promise<void> {
  const lines = snapshots.length ? snapshots.flatMap((snapshot, index) => [...(index ? [""] : []), ...snapshotLines(snapshot)]) : ["No usage data available."];
  if (ctx.mode !== "tui") {
    ctx.ui.notify(lines.join("\n"), snapshots.some((item) => item.state === "ok" || item.state === "stale") ? "info" : "warning");
    return;
  }
  await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Pi Usage · Provider Usage")), 1, 0));
    container.addChild(new Text(lines.map((line) => line.startsWith("    ") ? theme.fg("dim", line) : line).join("\n"), 1, 1));
    container.addChild(new Text(theme.fg("dim", "Enter/Esc close"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) done(); },
    };
  });
}

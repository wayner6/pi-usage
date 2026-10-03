import assert from "node:assert/strict";
import test from "node:test";
import extension from "../src/index.ts";

test("extension registers only the /usage command", () => {
  const commands: string[] = [];
  const pi = {
    registerCommand: (name: string) => { commands.push(name); },
    on: () => undefined,
    getCommands: () => [],
  };
  extension(pi as any);
  assert.deepEqual(commands, ["usage"]);
});

test("unsupported native providers are omitted from status, widget and current details", async () => {
  const events = new Map<string, (event: any, ctx: any) => Promise<void>>();
  let command: (args: string, ctx: any) => Promise<void> = async () => {};
  const statuses: unknown[] = [];
  const widgets: unknown[] = [];
  const notices: string[] = [];
  extension({
    registerCommand: (_name: string, options: any) => { command = options.handler; },
    on: (name: string, handler: any) => { events.set(name, handler); },
    getCommands: () => [],
  } as any);
  const model = { id: "other-model", provider: "github-copilot" };
  const ctx: any = {
    cwd: "/tmp", mode: "rpc", model,
    modelRegistry: {
      getProvider: () => ({ name: "GitHub Copilot" }),
      getProviderAuth: async () => undefined,
      getProviderDisplayName: () => "GitHub Copilot",
      getAll: () => [model],
    },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (_id: string, content: unknown) => { statuses.push(content); },
      setWidget: (_id: string, content: unknown) => { widgets.push(content); },
      notify: (text: string) => { notices.push(text); },
    },
  };
  try {
    await events.get("session_start")!({}, ctx);
    await command("current", ctx);
    await command("refresh", ctx);
    assert.equal(statuses.at(-1), undefined);
    assert.equal(widgets.at(-1), undefined);
    assert.equal(notices.some((text) => text.includes("GitHub Copilot")), false);
  } finally {
    await events.get("session_shutdown")!({}, ctx);
  }
});

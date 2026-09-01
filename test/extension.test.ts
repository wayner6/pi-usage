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

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runProject } from "../src/run.js";
import { writeGlobalConfig } from "./helpers.js";

const model = process.env.CHEATCODES_LIVE_MODEL;
const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

function fixture(root: string): string {
  let parent: string | null = null;
  const entry = (id: string, message: unknown): unknown => {
    const record = { type: "message", id, parentId: parent, timestamp: "2026-01-01T00:00:00Z", message };
    parent = id;
    return record;
  };
  return [
    { type: "session", version: 3, id: "smoke-session", timestamp: "2026-01-01T00:00:00Z", cwd: root },
    entry("u1", { role: "user", content: [{ type: "text", text: "Fix the failing parse test in src/parse.ts and keep the public API stable." }] }),
    entry("a1", { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "npm test" } }] }),
    entry("t1", { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "1 failing\nparse test failed" }], isError: false, exitCode: 1, details: {} }),
    entry("u2", { role: "user", content: [{ type: "text", text: "No, the tokenizer must handle nested quotes before splitting on semicolons." }] }),
    entry("a2", { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-2", name: "edit", arguments: { path: "src/parse.ts", patch: "-split(raw)\n+splitNested(raw)" } }] }),
    entry("t2", { role: "toolResult", toolCallId: "call-2", toolName: "edit", content: [{ type: "text", text: "Edited src/parse.ts" }], isError: false, details: {} }),
    entry("a3", { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-3", name: "bash", arguments: { command: "npm test" } }] }),
    entry("t3", { role: "toolResult", toolCallId: "call-3", toolName: "bash", content: [{ type: "text", text: "42 passing" }], isError: false, exitCode: 0, details: {} }),
    entry("a4", { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Fixed. The tokenizer now nests quotes before splitting on semicolons; the parse test passes." }] }),
  ].map(line).join("");
}

test("live model smoke test", { timeout: 300_000, skip: !model || process.env.CI === "true" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cheatcodes-live-"));
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions);
    const { env } = await writeGlobalConfig({ model: model!, inputs: [sessions] });
    await writeFile(path.join(sessions, "smoke.jsonl"), fixture(root));
    const result = await runProject({ root, env });
    console.log("run result:", JSON.stringify(result, null, 2));
    assert.equal(result.curatorCalls, 1);
    assert.ok(result.entriesWritten >= 1, "expected at least one entry write");
    const knowledge = await readFile(path.join(root, "CHEATCODES.md"), "utf8");
    console.log("--- CHEATCODES.md ---");
    console.log(knowledge);
    assert.match(knowledge, /^# CHEATCODES\n/);
    assert.match(knowledge, /## /);
    assert.equal(knowledge.includes("smoke-session"), false);
    const entries = await readdir(root);
    assert.equal(entries.includes(".cheatcodes"), false);
    for (const warning of result.warnings) console.log(`warning: ${warning}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

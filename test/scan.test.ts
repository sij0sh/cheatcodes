import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { scanInputs } from "../src/scan.js";
import { temporary } from "./helpers.js";

function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }

test("scanInputs excludes sessions whose cwd is not absolute on this platform", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    const projectSession = [
      { type: "session", version: 3, id: "project-session", timestamp: "2026-01-01T00:00:00Z", cwd: root },
      { type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "Please fix the adapter." }] } },
    ].map(line).join("");
    const foreignSession = [
      { type: "session", version: 3, id: "windows-session", timestamp: "2026-01-01T00:00:00Z", cwd: "C:\\Users\\joshs\\.pi" },
      { type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "Please fix the adapter." }] } },
    ].map(line).join("");
    await writeFile(path.join(sessions, "project.jsonl"), projectSession);
    await writeFile(path.join(sessions, "windows.jsonl"), foreignSession);
    const scan = await scanInputs([sessions], [root], {});
    assert.deepEqual(scan.changed.map((candidate) => path.basename(candidate.file)), ["project.jsonl"]);
    const skipped = scan.skipped.find((warning) => path.basename(warning.file) === "windows.jsonl");
    assert.ok(skipped, "foreign session must be reported as skipped");
    assert.match(skipped.message, /outside configured project roots/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { initializeProject } from "../src/config.js";
import type { Curator } from "../src/curate.js";
import { publishProject, runProject } from "../src/cli.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

const execFileAsync = promisify(execFile);
function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }

function fixture(root: string): string {
  return [
    { type: "session", version: 3, id: "session-1", timestamp: "2026-01-01T00:00:00Z", cwd: root },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "No, that is wrong. We must use the repository adapter instead." }] } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Understood. The repository adapter is required." }] } },
  ].map(line).join("");
}

test("init runs at the Git top level, publishes an empty bundle, and is idempotent", async () => {
  const root = await temporary();
  const originalCwd = process.cwd();
  try {
    await execFileAsync("git", ["init", "-q", root]);
    const nested = path.join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    const sessions = path.join(root, "sessions");
    await mkdir(sessions);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    process.chdir(nested);
    const first = await initializeProject({}, env);
    assert.equal(first.root, root);
    const second = await initializeProject({}, env);
    assert.equal(second.projectId, first.projectId);
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.equal(agents.match(/## Project knowledge/g)?.length, 1);
    await readFile(path.join(root, ".cheatcodes", "project.json"), "utf8");
    await readFile(path.join(root, ".cheatcodes", "knowledge", "index.md"), "utf8");
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("init requires a valid global config", async () => {
  const root = await temporary();
  try {
    const env = { CHEATCODES_CONFIG: path.join(root, "missing", "config.json") };
    await assert.rejects(initializeProject({ root }, env), /No global config/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("init and deterministic incremental run", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await initializeProject({ root }, env);
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.equal(agents.match(/## Project knowledge/g)?.length, 1);
    await writeFile(path.join(sessions, "one.jsonl"), fixture(root));
    let calls = 0;
    const curator: Curator = { async curate(packet) {
      calls++;
      return { concepts: [{ action: "create", type: "Decision", title: "Use the repository adapter", description: "Repository access uses the adapter.", tags: ["repository"], evidenceRefs: [packet.evidence[0]!.id], content: { answer: "Use the repository adapter.", rationale: "The direct approach violates project architecture." } }] };
    } };
    const first = await runProject({ root, curator, env, now: () => new Date("2026-01-01T00:00:00Z") });
    assert.equal(first.curatorCalls, 1);
    assert.equal(calls, 1);
    const stateBefore = await readFile(path.join(root, ".cheatcodes", "local", "state.json"));
    const knowledgeBefore = await readFile(path.join(root, ".cheatcodes", "knowledge", "index.md"));
    const second = await runProject({ root, curator, env });
    assert.equal(second.curatorCalls, 0);
    assert.equal(calls, 1);
    assert.deepEqual(await readFile(path.join(root, ".cheatcodes", "local", "state.json")), stateBefore);
    assert.deepEqual(await readFile(path.join(root, ".cheatcodes", "knowledge", "index.md")), knowledgeBefore);
    await rm(path.join(root, ".cheatcodes", "knowledge"), { recursive: true });
    await publishProject(root);
    assert.deepEqual(await readFile(path.join(root, ".cheatcodes", "knowledge", "index.md")), knowledgeBefore);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("partial final line remains uncommitted", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions"); await mkdir(sessions);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await initializeProject({ root }, env);
    const complete = line({ type: "session", version: 3, id: "s", cwd: root });
    await writeFile(path.join(sessions, "one.jsonl"), `${complete}{"type":"message"`);
    const curator: Curator = { async curate() { throw new Error("must not call"); } };
    await runProject({ root, curator, env });
    const state = JSON.parse(await readFile(path.join(root, ".cheatcodes", "local", "state.json"), "utf8"));
    assert.equal(state.files[path.join(sessions, "one.jsonl")].committedOffset, Buffer.byteLength(complete));
  } finally { await rm(root, { recursive: true, force: true }); }
});

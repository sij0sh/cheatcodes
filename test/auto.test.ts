import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { deriveProjectKey, emptyGlobalConfig, globalConfigPath, loadGlobalConfig, validateGlobalConfig } from "../src/config.js";
import type { Curator } from "../src/curate.js";
import { main } from "../src/cli.js";
import { projectStatus, runWorker, type RunOptions } from "../src/run.js";
import {
  acquireProjectLock,
  globalStatePath,
  loadGlobalState,
  projectLockPath,
  updateProjectState,
} from "../src/state.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

const execFileAsync = promisify(execFile);
function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }

function fixture(root: string, sessionId = "session-1"): string {
  return [
    { type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00Z", cwd: root },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "No, that is wrong. We must use the repository adapter instead." }] } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Understood. The repository adapter is required." }] } },
  ].map(line).join("");
}

function fakeCurator(calls: { count: number }): Curator {
  return { async curate(packet) {
    calls.count++;
    return { entries: [{ action: "create", title: "Use the repository adapter", summary: "Repository access uses the adapter.", body: "The repository adapter is the only persistence boundary.", tags: ["repository"], evidenceRefs: [packet.evidence[0]!.id] }] };
  } };
}

async function sessionsWithFixture(root: string, sessionId = "session-1"): Promise<string> {
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, "one.jsonl"), fixture(root, sessionId));
  return sessions;
}

async function gitInit(root: string): Promise<void> {
  await execFileAsync("git", ["init", "-q", root]);
}

function withCurator(options: RunOptions, curator: Curator): RunOptions {
  return { ...options, curator };
}

test("global config path honors the environment, XDG, and home fallbacks", () => {
  assert.equal(globalConfigPath({ CHEATCODES_CONFIG: "/tmp/explicit.json" }), path.resolve("/tmp/explicit.json"));
  assert.equal(globalConfigPath({ XDG_CONFIG_HOME: "/xdg" }), path.join("/xdg", "cheatcodes", "config.json"));
  assert.equal(globalConfigPath({}), path.join(homedir(), ".config", "cheatcodes", "config.json"));
});

test("global state path honors the override, XDG, and home fallbacks", () => {
  assert.equal(globalStatePath({ CHEATCODES_STATE: "/tmp/state.json" }), path.resolve("/tmp/state.json"));
  assert.equal(globalStatePath({ XDG_STATE_HOME: "/xdg-state" }), path.join("/xdg-state", "cheatcodes", "state.json"));
  assert.equal(globalStatePath({}), path.join(homedir(), ".local", "state", "cheatcodes", "state.json"));
});

test("global config validation enforces the version 2 shape", () => {
  assert.throws(() => validateGlobalConfig({ version: 1, model: "m", inputs: [], workerTimeoutMinutes: 1, projectAliases: {} }), /config version 2 removed "automation"/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), automation: { enabled: true, setupMissingProjects: true } }), /automation is not a recognized field/);
  assert.throws(() => validateGlobalConfig({ version: 3 }), /version must be 2/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), surprise: true }), /not a recognized field/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig(undefined) }), /model/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), workerTimeoutMinutes: 0 }), /workerTimeoutMinutes/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), knowledgeFile: "/tmp/out.md" }), /repository-relative/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), knowledgeFile: "../escape.md" }), /repository-relative/);
  const configured = validateGlobalConfig({ ...emptyGlobalConfig("m"), knowledgeFile: ".pi-files/CHEATCODES.md" });
  assert.equal(configured.knowledgeFile, ".pi-files/CHEATCODES.md");
  const valid = validateGlobalConfig(emptyGlobalConfig("m"));
  assert.equal(valid.version, 2);
});

test("project keys derive from the normalized remote and fall back to the real path", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const pathKey = await deriveProjectKey(root);
    assert.match(pathKey, /^path:[0-9a-f]{64}$/);
    const again = await deriveProjectKey(root);
    assert.equal(again, pathKey);
    await execFileAsync("git", ["-C", root, "remote", "add", "origin", "git@GitHub.com:Example/Org.Repo.git"], { cwd: root });
    const remoteKey = await deriveProjectKey(root);
    assert.match(remoteKey, /^git:[0-9a-f]{64}$/);
    assert.notEqual(remoteKey, pathKey);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("run outside a Git repository is skipped without writes", async () => {
  const cwd = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json"), CHEATCODES_STATE: path.join(configDir, "state.json") };
    const result = await runWorker({ cwd, env });
    assert.equal(result.outcome, "skipped");
    assert.match(result.reason!, /outside a Git repository/);
    assert.deepEqual(await readdir(cwd), []);
    assert.equal(await loadGlobalConfig(env), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("run skips when no config exists and no model hint is available", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    await gitInit(root);
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json"), CHEATCODES_STATE: path.join(configDir, "state.json") };
    const result = await runWorker({ root, env });
    assert.equal(result.outcome, "skipped");
    assert.match(result.reason!, /no global config/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("a model hint creates a missing version 2 config and never overwrites an existing model", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    await gitInit(root);
    const env: NodeJS.ProcessEnv = {
      CHEATCODES_CONFIG: path.join(configDir, "config.json"),
      CHEATCODES_STATE: path.join(configDir, "state.json"),
      CHEATCODES_PI_MODEL: "prov/m1",
      CHEATCODES_PI_THINKING: "high",
    };
    const result = await runWorker({ root, env, curator: fakeCurator({ count: 0 }) });
    assert.equal(result.outcome, "success");
    const created = await loadGlobalConfig(env);
    assert.equal(created!.model, "prov/m1:thinking");
    assert.deepEqual(created!.inputs, []);
    const { env: existingEnv } = await writeGlobalConfig({ dir: configDir, model: "fake/model" });
    const envWithHint = { ...existingEnv, CHEATCODES_PI_MODEL: "other/model" };
    await runWorker({ root, env: envWithHint, curator: fakeCurator({ count: 0 }) });
    assert.equal((await loadGlobalConfig(envWithHint))!.model, "fake/model");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("run creates the knowledge file and global state but no repository-local runtime data", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const result = await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    assert.equal(result.outcome, "success");
    await stat(path.join(root, "CHEATCODES.md"));
    const entries = await readdir(root);
    assert.equal(entries.includes(".cheatcodes"), false);
    assert.equal(entries.includes("worker.jsonl"), false);
    const state = await loadGlobalState(env);
    const project = state.projects[result.projectKey!]!;
    assert.equal(Object.keys(project.files).length, 1);
    assert.equal(project.lastRun!.outcome, "success");
    assert.equal(project.lastRun!.changedFiles, 1);
    await assert.rejects(stat(path.join(root, "last-run.json")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("knowledgeFile config moves the knowledge file and the AGENTS pointer", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions], knowledgeFile: ".pi-files/CHEATCODES.md" });
    const result = await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    assert.equal(result.outcome, "success");
    await stat(path.join(root, ".pi-files", "CHEATCODES.md"));
    await assert.rejects(stat(path.join(root, "CHEATCODES.md")), /ENOENT/);
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.match(agents, /Start with `\.pi-files\/CHEATCODES\.md`\./);
    const status = await projectStatus(root, env);
    assert.equal(status.entries, 1);
    assert.match(status.knowledgeFile, /\.pi-files\/CHEATCODES\.md$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("direct session-file hints are scanned as extra inputs", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [] });
    const envWithHints = { ...env, CHEATCODES_PI_SESSION_FILE: path.join(sessions, "one.jsonl") };
    const calls = { count: 0 };
    const result = await runWorker(withCurator({ root, env: envWithHints }, fakeCurator(calls)));
    assert.equal(result.outcome, "success");
    assert.equal(result.run!.changedFiles, 1);
    assert.equal(calls.count, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a second run coalesces under the project lock and records the outcome", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const projectKey = await deriveProjectKey(root);
    await acquireProjectLock(env, projectKey);
    const calls = { count: 0 };
    const result = await runWorker(withCurator({ root, env }, fakeCurator(calls)));
    assert.equal(result.outcome, "coalesced");
    assert.equal(calls.count, 0);
    const state = await loadGlobalState(env);
    assert.equal(state.projects[projectKey]!.lastRun!.outcome, "coalesced");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a stale lock is recovered automatically", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    await gitInit(root);
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json"), CHEATCODES_STATE: path.join(configDir, "state.json") };
    const projectKey = await deriveProjectKey(root);
    const lockFile = projectLockPath(env, projectKey);
    await mkdir(path.dirname(lockFile), { recursive: true });
    const dead = spawn(process.execPath, ["-e", ""]);
    await new Promise<void>((resolve) => dead.on("exit", () => resolve()));
    await writeFile(lockFile, `${JSON.stringify({ pid: dead.pid, startedAt: "2026-01-01T00:00:00Z" })}\n`);
    const lock = await acquireProjectLock(env, projectKey);
    assert.equal(lock.staleRecovered, true);
    await lock.release();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("worker timeout aborts work, records the timeout, and releases the lock", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = path.join(root, "sessions");
    await mkdir(sessions);
    await writeFile(path.join(sessions, "one.jsonl"), fixture(root, "s1"));
    await writeFile(path.join(sessions, "two.jsonl"), fixture(root, "s2"));
    const { env } = await writeGlobalConfig({ inputs: [sessions], workerTimeoutMinutes: 0.0001 });
    const calls = { count: 0 };
    const sleepyCurator: Curator = { async curate(packet) {
      calls.count++;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return fakeCurator(calls).curate(packet);
    } };
    const result = await runWorker({ root, env, curator: sleepyCurator });
    assert.equal(result.outcome, "timeout");
    assert.equal(result.run!.deadlineExceeded, true);
    const state = await loadGlobalState(env);
    assert.equal(state.projects[result.projectKey!]!.lastRun!.outcome, "timeout");
    await assert.rejects(stat(projectLockPath(env, result.projectKey!)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status reports one entry count and the latest global run result", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    const status = await projectStatus(root, env);
    assert.equal(status.discoveredFiles, 1);
    assert.equal(status.entries, 1);
    assert.equal(status.lastRun!.outcome, "success");
    assert.deepEqual(status.missingInputs, []);
    assert.match(status.projectKey, /^(git|path):[0-9a-f]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("removed inputs prune obsolete cursors from global state", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    await rm(sessions, { recursive: true });
    const result = await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    assert.equal(result.run!.prunedCursors, 1);
    const state = await loadGlobalState(env);
    assert.deepEqual(state.projects[result.projectKey!]!.files, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("two projects keep isolated entries in one global state file", async () => {
  const configDir = await temporary("cheatcodes-config-");
  const rootA = await temporary();
  const rootB = await temporary();
  try {
    await gitInit(rootA);
    await gitInit(rootB);
    const sessionsA = await sessionsWithFixture(rootA, "a-1");
    const sessionsB = await sessionsWithFixture(rootB, "b-1");
    const { env } = await writeGlobalConfig({ dir: configDir, inputs: [sessionsA, sessionsB] });
    const [a, b] = await Promise.all([
      runWorker(withCurator({ root: rootA, env }, fakeCurator({ count: 0 }))),
      runWorker(withCurator({ root: rootB, env }, fakeCurator({ count: 0 }))),
    ]);
    assert.notEqual(a.projectKey, b.projectKey);
    const state = await loadGlobalState(env);
    assert.equal(Object.keys(state.projects).length, 2);
    assert.equal(state.projects[a.projectKey!]!.lastRun!.outcome, "success");
    assert.equal(state.projects[b.projectKey!]!.lastRun!.outcome, "success");
  } finally {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("concurrent state updates to different projects are merged", async () => {
  const configDir = await temporary("cheatcodes-config-");
  try {
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json"), CHEATCODES_STATE: path.join(configDir, "state.json") };
    const cursor = { sessionId: "s", committedOffset: 1, observedSize: 1, mtimeMs: 1, prefixSha256: "abc" };
    await Promise.all([
      updateProjectState(env, "git:aaa", (project) => ({ ...project, files: { ...project.files, "a.jsonl": cursor } })),
      updateProjectState(env, "git:bbb", (project) => ({ ...project, files: { ...project.files, "b.jsonl": cursor } })),
    ]);
    const state = await loadGlobalState(env);
    assert.deepEqual(Object.keys(state.projects).sort(), ["git:aaa", "git:bbb"]);
  } finally { await rm(configDir, { recursive: true, force: true }); }
});

test("failed runs record the failure and return a failed outcome", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const failingCurator: Curator = { async curate() { throw new Error("curator exploded"); } };
    const result = await runWorker({ root, env, curator: failingCurator });
    assert.equal(result.outcome, "failed");
    assert.match(result.reason!, /curator exploded/);
    const state = await loadGlobalState(env);
    assert.equal(state.projects[result.projectKey!]!.lastRun!.outcome, "failed");
    await stat(path.join(root, "CHEATCODES.md"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unknown commands including init and publish fail with exit code 2", async () => {
  const original = process.exitCode;
  try {
    await main(["bogus"]);
    assert.equal(process.exitCode, 2);
    process.exitCode = original;
    await main(["init"]);
    assert.equal(process.exitCode, 2);
    process.exitCode = original;
    await main(["publish"]);
    assert.equal(process.exitCode, 2);
    process.exitCode = original;
    await main(["run", "--model", "x"]);
    assert.equal(process.exitCode, 2);
  } finally { process.exitCode = original; }
});

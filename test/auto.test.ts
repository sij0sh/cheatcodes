import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { findProjectRoot, globalConfigPath, initializeProject, loadGlobalConfig, validateGlobalConfig } from "../src/config.js";
import type { Curator } from "../src/curate.js";
import { main, projectStatus, runProject } from "../src/cli.js";
import { acquireProjectLock } from "../src/state.js";
import { readLastRun, runAuto } from "../src/worker.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

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
    return { concepts: [{ action: "create", type: "Decision", title: "Use the repository adapter", description: "Repository access uses the adapter.", tags: ["repository"], evidenceRefs: [packet.evidence[0]!.id], content: { answer: "Use the repository adapter.", rationale: "The direct approach violates project architecture." } }] };
  } };
}

async function sessionsWithFixture(root: string): Promise<string> {
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, "one.jsonl"), fixture(root));
  return sessions;
}

test("global config path honors the environment, XDG, and home fallbacks", () => {
  assert.equal(globalConfigPath({ CHEATCODES_CONFIG: "/tmp/explicit.json" }), path.resolve("/tmp/explicit.json"));
  assert.equal(globalConfigPath({ XDG_CONFIG_HOME: "/xdg" }), path.join("/xdg", "cheatcodes", "config.json"));
  assert.equal(globalConfigPath({}), path.join(homedir(), ".config", "cheatcodes", "config.json"));
});

test("global config validation rejects unknown versions and invalid fields", () => {
  assert.throws(() => validateGlobalConfig({ version: 2 }), /version must be 1/);
  assert.throws(() => validateGlobalConfig({ version: 1, surprise: true }), /not a recognized field/);
  assert.throws(() => validateGlobalConfig(fullConfigWith({ model: undefined })), /config\.model/);
  assert.throws(() => validateGlobalConfig(fullConfigWith({ automation: { enabled: "yes" } })), /automation.enabled/);
  assert.throws(() => validateGlobalConfig(fullConfigWith({ workerTimeoutMinutes: 0 })), /workerTimeoutMinutes/);
  function fullConfigWith(patch: Record<string, unknown>): Record<string, unknown> {
    return { version: 1, model: "fake/model", inputs: [], automation: { enabled: true, setupMissingProjects: true }, workerTimeoutMinutes: 10, projectAliases: {}, ...patch };
  }
});

test("auto outside a Git repository exits without writes", async () => {
  const cwd = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json") };
    const result = await runAuto({ cwd, env });
    assert.equal(result.outcome, "skipped");
    assert.match(result.reason!, /outside a Git repository/);
    assert.deepEqual(await readdir(cwd), []);
    assert.equal(await loadGlobalConfig(env), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("auto skips when automation is disabled", async () => {
  const root = await temporary();
  try {
    const { env } = await writeGlobalConfig({ automation: { enabled: false } });
    const result = await runAuto({ root, env });
    assert.equal(result.outcome, "skipped");
    assert.match(result.reason!, /automation is disabled/);
    await assert.rejects(stat(path.join(root, ".cheatcodes", "project.json")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("auto sets up and runs a missing project by default", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    const result = await runAuto({ root, env, curator: fakeCurator(calls) });
    assert.equal(result.outcome, "success");
    assert.equal(result.run!.changedFiles, 1);
    assert.equal(calls.count, 1);
    const identity = JSON.parse(await readFile(path.join(root, ".cheatcodes", "project.json"), "utf8"));
    assert.match(identity.projectId, /^local:/);
    const last = await readLastRun(root);
    assert.equal(last!.outcome, "success");
    await stat(path.join(root, ".cheatcodes", "local", "worker.jsonl"));
    await stat(path.join(root, ".cheatcodes", "knowledge", "index.md"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("auto uses a Pi model hint only to create a missing global config", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    const sessions = await sessionsWithFixture(root);
    const env: NodeJS.ProcessEnv = {
      CHEATCODES_CONFIG: path.join(configDir, "config.json"),
      CHEATCODES_PI_MODEL: "prov/m1",
      CHEATCODES_PI_THINKING: "high",
    };
    const calls = { count: 0 };
    const result = await runAuto({ root, env, curator: fakeCurator(calls) });
    assert.equal(result.outcome, "success");
    const global = await loadGlobalConfig(env);
    assert.equal(global!.model, "prov/m1:high");
    assert.deepEqual(global!.inputs, []);
    assert.equal(result.run!.changedFiles, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("an existing global model is never overwritten by a Pi model hint", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ model: "fake/model", inputs: [sessions] });
    const envWithHint = { ...env, CHEATCODES_PI_MODEL: "other/model" };
    const calls = { count: 0 };
    await runAuto({ root, env: envWithHint, curator: fakeCurator(calls) });
    assert.equal((await loadGlobalConfig(envWithHint))!.model, "fake/model");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("direct session-file and session-directory hints are scanned", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [] });
    const envWithHints = { ...env, CHEATCODES_PI_SESSION_FILE: path.join(sessions, "one.jsonl") };
    const calls = { count: 0 };
    const result = await runAuto({ root, env: envWithHints, curator: fakeCurator(calls) });
    assert.equal(result.outcome, "success");
    assert.equal(result.run!.changedFiles, 1);
    assert.equal(calls.count, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a second auto worker coalesces under the project lock", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await acquireProjectLock(root);
    const calls = { count: 0 };
    const result = await runAuto({ root, env, curator: fakeCurator(calls) });
    assert.equal(result.outcome, "coalesced");
    assert.equal(calls.count, 0);
    assert.equal((await readLastRun(root))!.outcome, "coalesced");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("worker timeout aborts work, records failure, and releases the lock", async () => {
  const root = await temporary();
  try {
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
    const result = await runAuto({ root, env, curator: sleepyCurator });
    assert.equal(result.outcome, "timeout");
    assert.equal(result.run!.deadlineExceeded, true);
    const last = await readLastRun(root);
    assert.equal(last!.outcome, "timeout");
    await assert.rejects(stat(path.join(root, ".cheatcodes", "local", "run.lock")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status reports current inputs and the last worker result", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runAuto({ root, env, curator: fakeCurator({ count: 0 }) });
    const status = await projectStatus(root, env);
    assert.equal(status.discoveredFiles, 1);
    assert.equal(status.lastRun!.outcome, "success");
    assert.deepEqual(status.missingInputs, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("removed inputs prune obsolete cursors safely", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await initializeProject({ root }, env);
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    await rm(sessions, { recursive: true });
    const result = await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    assert.equal(result.prunedCursors, 1);
    const state = JSON.parse(await readFile(path.join(root, ".cheatcodes", "local", "state.json"), "utf8"));
    assert.deepEqual(state.files, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy config and state migrate byte-safely and idempotently", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    const sessions = await sessionsWithFixture(root);
    const cheatcodes = path.join(root, ".cheatcodes");
    await mkdir(path.join(cheatcodes, "operations"), { recursive: true });
    const legacyState = `{"version":1,"files":{"${sessions}/one.jsonl":{"sessionId":"session-1","committedOffset":5,"observedSize":10,"mtimeMs":1,"prefixSha256":"abc"}}}\n`;
    await writeFile(path.join(cheatcodes, "state.json"), legacyState);
    await writeFile(path.join(cheatcodes, "operations", "op-1.json"), "{}\n");
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json") };
    await writeFile(path.join(cheatcodes, "config.json"), JSON.stringify({
      projectId: "legacy/project",
      model: "legacy/model",
      inputs: [sessions],
      projectRoots: [".", "/elsewhere"],
    }));
    const migrated = await findProjectRoot(root, env);
    assert.equal(migrated, root);
    const global = await loadGlobalConfig(env);
    assert.equal(global!.model, "legacy/model");
    assert.deepEqual(global!.inputs, [path.resolve(sessions)]);
    assert.deepEqual(global!.projectAliases["legacy/project"], ["/elsewhere"]);
    assert.equal(await readFile(path.join(cheatcodes, "local", "state.json"), "utf8"), legacyState);
    await stat(path.join(cheatcodes, "local", "operations", "op-1.json"));
    await stat(path.join(cheatcodes, "project.json"));
    await assert.rejects(stat(path.join(cheatcodes, "config.json")));
    await stat(path.join(cheatcodes, "knowledge", "index.md"));
    
    const before = await readFile(path.join(cheatcodes, "local", "state.json"));
    const again = await findProjectRoot(root, env);
    assert.equal(again, root);
    assert.deepEqual(await readFile(path.join(cheatcodes, "local", "state.json")), before);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("a model conflict preserves the global model and records a warning", async () => {
  const root = await temporary();
  try {
    const cheatcodes = path.join(root, ".cheatcodes");
    await mkdir(cheatcodes, { recursive: true });
    const { env } = await writeGlobalConfig({ model: "global/model" });
    await writeFile(path.join(cheatcodes, "config.json"), JSON.stringify({
      projectId: "legacy/project",
      model: "legacy/model",
      inputs: [path.join(root, "sessions")],
      projectRoots: ["."],
    }));
    await assert.equal((await findProjectRoot(root, env)), root);
    const global = await loadGlobalConfig(env);
    assert.equal(global!.model, "global/model");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a failed migration leaves the complete legacy layout usable", async () => {
  const root = await temporary();
  try {
    const cheatcodes = path.join(root, ".cheatcodes");
    await mkdir(cheatcodes, { recursive: true });
    const legacyConfig = path.join(cheatcodes, "config.json");
    await writeFile(legacyConfig, "{ not json");
    await writeFile(path.join(cheatcodes, "state.json"), "{}\n");
    const env = { CHEATCODES_CONFIG: path.join(root, "global.json") };
    await assert.rejects(findProjectRoot(root, env), /config\.json/);
    await stat(legacyConfig);
    await stat(path.join(cheatcodes, "state.json"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unknown commands and options fail with exit code 2", async () => {
  const original = process.exitCode;
  try {
    await main(["bogus"]);
    assert.equal(process.exitCode, 2);
    process.exitCode = original;
    await main(["run", "--model", "x"]);
    assert.equal(process.exitCode, 2);
  } finally { process.exitCode = original; }
});

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { Curator } from "../src/curate.js";
import { createPacket, segmentSession, successfulMutation } from "../src/harvest.js";
import { WORKER_ORIGIN, parseJsonlBytes } from "../src/jsonl.js";
import { runProject } from "../src/run.js";
import { loadGlobalState } from "../src/state.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }
const session = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00Z", cwd: "/repo", ...extra });
const user = (id: string, parentId: string | null, text: string, timestamp: string): Record<string, unknown> =>
  ({ type: "message", id, parentId, timestamp, message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (id: string, parentId: string, text: string, timestamp: string): Record<string, unknown> =>
  ({ type: "message", id, parentId, timestamp, message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] } });
const toolCall = (id: string, parentId: string, callId: string, tool: string, args: Record<string, unknown>, timestamp: string): Record<string, unknown> =>
  ({ type: "message", id, parentId, timestamp, message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: callId, name: tool, arguments: args }] } });
const toolResult = (id: string, parentId: string, callId: string, tool: string, timestamp: string, extra: Record<string, unknown>, text: string): Record<string, unknown> =>
  ({ type: "message", id, parentId, timestamp, message: { role: "toolResult", toolCallId: callId, toolName: tool, content: [{ type: "text", text }], ...extra } });

function fixFailedMutationSession(editResult: Record<string, unknown>): Buffer {
  return Buffer.from([
    line(session("s1")),
    line(user("u1", null, "Fix the repository adapter and make the tests pass.", "2026-01-01T00:00:01Z")),
    line(toolCall("a1", "u1", "call-1", "bash", { command: "npm test" }, "2026-01-01T00:00:02Z")),
    line(toolResult("t1", "a1", "call-1", "bash", "2026-01-01T00:00:03Z", { exitCode: 1 }, "1 failing test in the repository adapter")),
    line(toolCall("a2", "t1", "call-2", "edit", { path: "src/adapter.ts", patch: "handle the empty repository cache" }, "2026-01-01T00:00:04Z")),
    line(toolResult("t2", "a2", "call-2", "edit", "2026-01-01T00:00:05Z", editResult, "applied the repository adapter fix")),
    line(toolCall("a3", "t2", "call-3", "bash", { command: "npm test" }, "2026-01-01T00:00:06Z")),
    line(toolResult("t3", "a3", "call-3", "bash", "2026-01-01T00:00:07Z", { exitCode: 0 }, "all repository adapter tests pass")),
    line(assistant("a4", "t3", "The repository adapter fix is settled and the tests pass.", "2026-01-01T00:00:08Z")),
  ].join(""));
}

function fixCommandSession(commands: [string, number][]): Buffer {
  const lines = [
    line(session("s1")),
    line(user("u1", null, "Inspect the repository state and report what you find.", "2026-01-01T00:00:01Z")),
  ];
  let parent = "u1";
  let at = 2;
  for (const [index, [command, exitCode]] of commands.entries()) {
    lines.push(line(toolCall(`a${index}`, parent, `call-${index}`, "bash", { command }, `2026-01-01T00:00:0${at}Z`)));
    lines.push(line(toolResult(`t${index}`, `a${index}`, `call-${index}`, "bash", `2026-01-01T00:00:0${at + 1}Z`, { exitCode }, `output of ${command}`)));
    parent = `t${index}`;
    at += 2;
  }
  lines.push(line(assistant("afinal", parent, "The repository inspection is complete.", `2026-01-01T00:00:1${at}Z`)));
  return Buffer.from(lines.join(""));
}

test("checkpoint fixture: failed transition, correction, and retry settle in one episode", async () => {
  const bytes = await readFile(new URL("./fixtures/episodes/checkpoint-recovery.jsonl", import.meta.url));
  const parsed = parseJsonlBytes(bytes, { file: "checkpoint-recovery.jsonl" });
  const episodes = segmentSession(parsed);
  const settled = episodes.find((episode) => episode.closure === "workflow-terminal");
  assert.ok(settled);
  assert.deepEqual(settled.recordIds, ["u1", "t1", "u2", "t2"]);
  assert.equal(settled.eligible, true);
  assert.equal(settled.branchLeafId, "a1");
  assert.equal(settled.signals.includes("correction"), true);
  assert.equal(settled.signals.includes("workflow-checkpoint"), true);
  assert.ok(settled.signalReasons.length >= 2);
  const packet = createPacket(settled, { projectKey: "fixture" });
  assert.ok(packet);
  assert.equal(packet!.closure, "workflow-terminal");
  assert.equal(packet!.omittedEvidenceCount, 0);
  assert.equal(packet!.packetFitReason, "fit");
  const excerpts = packet!.evidence.map((item) => item.excerpt).join("\n");
  assert.match(excerpts, /must ride under checkpoint\.data/);
  assert.match(excerpts, /Accepted transition into implement-phase0/);
  for (const episode of episodes) {
    if (episode !== settled) assert.equal(episode.eligible, false);
  }
});

test("record fields link turns, calls, stop reasons, and branch leaves deterministically", () => {
  const bytes = Buffer.from([
    line(session("s1")),
    line(user("u1", null, "Run the repository test suite twice and report.", "2026-01-01T00:00:01Z")),
    line(toolCall("acall", "u1", "call-1", "bash", { command: "npm test" }, "2026-01-01T00:00:02Z")),
    line(toolResult("t1", "acall", "call-1", "bash", "2026-01-01T00:00:03Z", { exitCode: 1 }, "first run failed")),
    line(toolCall("acall2", "t1", "call-2", "bash", { command: "npm test" }, "2026-01-01T00:00:04Z")),
    line(toolResult("t2", "acall2", "call-2", "bash", "2026-01-01T00:00:05Z", { exitCode: 0 }, "second run passed")),
    line(assistant("a1", "t2", "The second repository run passed.", "2026-01-01T00:00:06Z")),
  ].join(""));
  const parsed = parseJsonlBytes(bytes, { file: "multi.jsonl" });
  assert.equal(parsed.origin, "user-session");
  const episodes = segmentSession(parsed);
  assert.equal(episodes.length, 1);
  const episode = episodes[0]!;
  assert.equal(episode.closure, "assistant-settled");
  assert.deepEqual(episode.recordIds, ["u1", "t1", "t2", "a1"]);
  const settled = parsed.records.find((record) => record.kind === "assistant")!;
  assert.equal(settled.assistantStopReason, "stop");
  for (const record of parsed.records) {
    assert.equal(record.branchLeafId, "a1");
    assert.equal(record.turnId, "acall");
    if (record.receipt) assert.equal(record.toolCallId?.startsWith("call-"), true);
  }
  const again = parseJsonlBytes(bytes, { file: "multi.jsonl" });
  assert.deepEqual(again.records.map((record) => record.turnId), parsed.records.map((record) => record.turnId));
});

test("a failed mutation does not resolve the failure; a clean mutation does", () => {
  assert.equal(successfulMutation({ tool: "edit", mutation: true, validation: "none", isError: true }), false);
  assert.equal(successfulMutation({ tool: "edit", mutation: true, validation: "none" }), true);
  assert.equal(successfulMutation({ tool: "read", mutation: false, validation: "none" }), false);

  const failed = segmentSession(parseJsonlBytes(fixFailedMutationSession({ isError: true }), { file: "f.jsonl" }));
  assert.deepEqual(failed.map((episode) => episode.closure), ["assistant-settled"]);
  assert.equal(failed[0]!.signals.includes("resolved-failure"), false);
  assert.equal(createPacket(failed[0]!, { projectKey: "k" }), undefined);

  const recovered = segmentSession(parseJsonlBytes(fixFailedMutationSession({ exitCode: 0 }), { file: "f.jsonl" }));
  assert.equal(recovered[0]!.closure, "assistant-settled");
  assert.equal(recovered[0]!.signals.includes("resolved-failure"), true);
  const packet = createPacket(recovered[0]!, { projectKey: "k" });
  assert.ok(packet);
  const excerpts = packet!.evidence.map((item) => item.excerpt).join("\n");
  assert.match(excerpts, /failing test/);
  assert.match(excerpts, /handle the empty repository cache/);
});

test("an accepted checkpoint alone annotates but never nominates a packet", () => {
  const parsed = parseJsonlBytes(Buffer.from([
    line(session("s1")),
    line(user("u1", null, "Advance the workflow gate after checking the state.", "2026-01-01T00:00:01Z")),
    line(toolCall("a1", "u1", "call-1", "workflow_transition", { status: "accepted" }, "2026-01-01T00:00:02Z")),
    line(toolResult("t1", "a1", "call-1", "workflow_transition", "2026-01-01T00:00:03Z", { accepted: true }, "Accepted transition into the next node.")),
  ].join("")), { file: "cp.jsonl" });
  const episodes = segmentSession(parsed);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]!.closure, "workflow-terminal");
  assert.deepEqual(episodes[0]!.signals, ["workflow-checkpoint"]);
  assert.equal(createPacket(episodes[0]!, { projectKey: "k" }), undefined);
});

test("audit-like commands without validated success never become procedures", () => {
  const audits = segmentSession(parseJsonlBytes(fixCommandSession([["git status", 0], ["git log", 0]]), { file: "a.jsonl" }));
  assert.equal(audits[0]!.signals.includes("procedure"), false);
  assert.equal(createPacket(audits[0]!, { projectKey: "k" }), undefined);

  const verified = segmentSession(parseJsonlBytes(fixCommandSession([["npm test", 0], ["npm run build", 0]]), { file: "a.jsonl" }));
  assert.equal(verified[0]!.signals.includes("procedure"), true);
  assert.ok(createPacket(verified[0]!, { projectKey: "k" }));
});

test("fitting drops low-priority context, never separates a failure from its recovery, and rejects unwritable packets", () => {
  const episode = segmentSession(parseJsonlBytes(fixFailedMutationSession({ exitCode: 0 }), { file: "f.jsonl" }))[0]!;
  const full = createPacket(episode, { projectKey: "k" })!;
  assert.equal(full.packetFitReason, "fit");

  const fitted = createPacket(episode, { projectKey: "k", packetCharacterCap: JSON.stringify(full).length - 260 });
  assert.ok(fitted);
  assert.equal(fitted!.packetFitReason, "omitted-evidence");
  assert.ok(fitted!.omittedEvidenceCount > 0);
  const failure = fitted!.evidence.find((item) => item.excerpt.includes("failing test"));
  const recovery = fitted!.evidence.find((item) => item.excerpt.includes("handle the empty repository cache"));
  if (failure) assert.ok(recovery, "failure retained without its recovery");
  assert.ok(fitted!.evidence.some((item) => item.excerpt.includes("all repository adapter tests pass")));

  assert.equal(createPacket(episode, { projectKey: "k", packetCharacterCap: 120 }), undefined);
});

test("interrupting user messages supersede open episodes and trailing groups stay incomplete", () => {
  const parsed = parseJsonlBytes(Buffer.from([
    line(session("s1")),
    line(user("u1", null, "Start the repository migration to the new adapter.", "2026-01-01T00:00:01Z")),
    line(toolCall("a1", "u1", "call-1", "bash", { command: "npm run migrate" }, "2026-01-01T00:00:02Z")),
    line(toolResult("t1", "a1", "call-1", "bash", "2026-01-01T00:00:03Z", { exitCode: 1 }, "migration failed")),
    line(user("u2", "t1", "Pause here. We will resume the repository migration tomorrow.", "2026-01-01T00:00:04Z")),
  ].join("")), { file: "sup.jsonl" });
  const episodes = segmentSession(parsed);
  assert.deepEqual(episodes.map((episode) => episode.closure), ["user-superseded", "incomplete"]);
  for (const episode of episodes) assert.equal(episode.eligible, false);
  for (const episode of episodes) assert.equal(createPacket(episode, { projectKey: "k" }), undefined);
});

test("episodes unique to abandoned branches are dropped in favor of the active branch", () => {
  const parsed = parseJsonlBytes(Buffer.from([
    line(session("s1")),
    line(user("u1", null, "First try the cache adapter for the repository layer.", "2026-01-01T00:00:01Z")),
    line(assistant("a1", "u1", "The cache adapter is in place for the repository layer.", "2026-01-01T00:00:02Z")),
    line(user("u2", "u1", "No, that is wrong. Use the queue adapter for the repository layer instead.", "2026-01-01T00:00:03Z")),
    line(assistant("a2", "u2", "The queue adapter is in place for the repository layer.", "2026-01-01T00:00:04Z")),
  ].join("")), { file: "branch.jsonl" });
  const episodes = segmentSession(parsed);
  assert.equal(episodes.length, 1);
  assert.deepEqual(episodes[0]!.recordIds, ["u1", "u2", "a2"]);
  assert.equal(episodes[0]!.closure, "assistant-settled");
  assert.equal(episodes[0]!.signals.includes("correction"), true);
  assert.equal(JSON.stringify(episodes).includes("cache adapter is in place"), false);
});

test("cheatcodes-worker origin is rejected at scan, parse, and packet levels", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, "worker.jsonl"), [
      line(session("worker-1", { origin: WORKER_ORIGIN, cwd: root })),
      line(user("w1", null, "No, that is wrong. Use the repository adapter instead.", "2026-01-01T00:00:01Z")),
      line(assistant("w2", "w1", "Understood. The repository adapter is required.", "2026-01-01T00:00:02Z")),
    ].join("").replaceAll("/repo", root));
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    const warnings: string[] = [];
    const result = await runProject({ root, env, curator: { async curate() { calls.count++; return { entries: [] }; } }, onWarning: (message) => warnings.push(message) });
    assert.equal(result.changedFiles, 0);
    assert.equal(result.packets, 0);
    assert.equal(calls.count, 0);
    assert.equal(warnings.some((message) => /cheatcodes-worker session excluded/.test(message)), true);
  } finally { await rm(root, { recursive: true, force: true }); }

  const headerMarked = parseJsonlBytes(Buffer.from([
    line(session("s1", { origin: WORKER_ORIGIN })),
    line(user("u1", null, "Try the repository adapter approach.", "2026-01-01T00:00:01Z")),
    line(assistant("a1", "u1", "The repository adapter approach is in place.", "2026-01-01T00:00:02Z")),
  ].join("")), { file: "w.jsonl" });
  assert.equal(headerMarked.origin, "cheatcodes-worker");
  const recordMarked = parseJsonlBytes(Buffer.from([
    line(session("s2")),
    line({ ...user("u1", null, "No, that is wrong. Use the queue adapter instead.", "2026-01-01T00:00:01Z"), origin: WORKER_ORIGIN }),
    line(assistant("a1", "u1", "The queue adapter is in place.", "2026-01-01T00:00:02Z")),
  ].join("")), { file: "w.jsonl" });
  assert.equal(recordMarked.origin, "cheatcodes-worker");
  assert.equal(recordMarked.records[0]!.origin, WORKER_ORIGIN);
  const episode = segmentSession(recordMarked)[0]!;
  assert.equal(episode.eligible, true);
  assert.equal(episode.signals.includes("correction"), true);
  assert.equal(createPacket(episode, { projectKey: "k" }), undefined);
});

test("schema failure parks the file without a cursor and the next run retries it", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, "one.jsonl"), [
      line(session("session-1", { cwd: root })),
      line(user("u1", null, "No, that is wrong. Use the repository adapter instead.", "2026-01-01T00:00:01Z")),
      line(assistant("a1", "u1", "Understood. The repository adapter is required.", "2026-01-01T00:00:02Z")),
    ].join("").replaceAll("/repo", root));
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    const failing: Curator = { async curate() { calls.count++; return { schemaInvalid: true, warning: "synthetic schema failure" }; } };
    const warnings: string[] = [];
    const first = await runProject({ root, env, curator: failing, onWarning: (message) => warnings.push(message) });
    assert.equal(first.packets, 1);
    assert.equal(first.unresolvedFiles, 1);
    assert.equal(calls.count, 1);
    assert.equal(warnings.some((message) => /parking/.test(message)), true);
    const parkedState = await loadGlobalState(env);
    assert.deepEqual(Object.keys(parkedState.projects[first.projectKey]?.files ?? {}), []);

    const second = await runProject({ root, env, curator: failing });
    assert.equal(second.unresolvedFiles, 1);
    assert.equal(calls.count, 2);

    const working: Curator = { async curate(packet) {
      calls.count++;
      return { entries: [{ action: "create", title: "Use the repository adapter", summary: "Repository access uses the adapter.", body: "The repository adapter is the only persistence boundary.", tags: [], evidenceRefs: [packet.evidence[0]!.id] }] };
    } };
    const third = await runProject({ root, env, curator: working });
    assert.equal(third.unresolvedFiles, 0);
    assert.equal(calls.count, 3);
    assert.equal(third.entriesWritten, 1);
    const state = await loadGlobalState(env);
    assert.equal(Object.keys(state.projects[first.projectKey]!.files).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

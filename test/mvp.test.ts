import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { Curator } from "../src/curate.js";
import { runProject } from "../src/run.js";
import { loadGlobalState } from "../src/state.js";
import { normalizeRepositoryPath, parseJsonlBytes, redactSecrets } from "../src/jsonl.js";
import { parseKnowledgeMarkdown } from "../src/concept.js";
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
    return { entries: [{ action: "create", title: "Use the repository adapter", summary: "Repository access uses the adapter.", body: "The repository adapter is the only persistence boundary.", tags: ["repository"], evidenceRefs: [packet.evidence[0]!.id] }] };
  } };
}

async function sessionsWithFixture(root: string, sessionId = "session-1"): Promise<string> {
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, "one.jsonl"), fixture(root, sessionId));
  return sessions;
}

test("first run uses the working directory as the project root and creates one knowledge file", async () => {
  const root = await temporary();
  const originalCwd = process.cwd();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    process.chdir(root);
    const calls = { count: 0 };
    const result = await runProject({ env, curator: fakeCurator(calls) });
    assert.equal(result.root, root);
    assert.equal(result.changedFiles, 1);
    assert.equal(calls.count, 1);
    const knowledge = await readFile(path.join(root, ".agents", "CHEATCODES.md"), "utf8");
    assert.match(knowledge, /^# CHEATCODES\n/);
    assert.match(knowledge, /## Use the repository adapter\n/);
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.match(agents, /## Project knowledge/);
    assert.match(agents, /`\.agents\/CHEATCODES\.md`/);
    const entries = await readdir(root);
    assert.equal(entries.includes(".cheatcodes"), false);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("run requires a global config", async () => {
  const root = await temporary();
  try {
    const env = { CHEATCODES_CONFIG: path.join(root, "missing", "config.json"), CHEATCODES_STATE: path.join(root, "state.json") };
    await assert.rejects(runProject({ root, env }), /No global config/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runs are deterministic and incremental with global state cursors", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    const first = await runProject({ root, env, curator: fakeCurator(calls) });
    assert.equal(first.curatorCalls, 1);
    assert.equal(first.entriesWritten, 1);
    const knowledgeFile = path.join(root, ".agents", "CHEATCODES.md");
    const knowledgeAfterFirst = await readFile(knowledgeFile, "utf8");
    const stateAfterFirst = await loadGlobalState(env);
    const key = first.projectKey;
    const files = Object.keys(stateAfterFirst.projects[key]!.files);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.startsWith(sessions), true);
    const second = await runProject({ root, env, curator: fakeCurator(calls) });
    assert.equal(second.curatorCalls, 0);
    assert.equal(await readFile(knowledgeFile, "utf8"), knowledgeAfterFirst);
    assert.deepEqual(await loadGlobalState(env), stateAfterFirst);
    await writeFile(path.join(sessions, "one.jsonl"), fixture(root) + '{"type":"message","id":"u2"');
    const third = await runProject({ root, env, curator: fakeCurator(calls) });
    assert.equal(third.curatorCalls, 0);
    assert.equal(await readFile(knowledgeFile, "utf8"), knowledgeAfterFirst);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a rewritten source file is reconsidered without duplicating entries", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root, "session-1");
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    await runProject({ root, env, curator: fakeCurator(calls) });
    await writeFile(path.join(sessions, "one.jsonl"), fixture(root, "session-2"));
    const warnings: string[] = [];
    const second = await runProject({ root, env, curator: fakeCurator(calls), onWarning: (message) => warnings.push(message) });
    assert.equal(warnings.some((message) => /source was rewritten/.test(message)), true);
    assert.equal(second.curatorCalls, 1);
    assert.equal(second.entriesWritten, 1);
    const knowledge = await readFile(path.join(root, ".agents", "CHEATCODES.md"), "utf8");
    assert.equal(knowledge.match(/## Use the repository adapter/g)?.length, 1);
    assert.match(knowledge, /session:session-1#records=/);
    assert.match(knowledge, /session:session-2#records=/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("durable output contains no evidence excerpts", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    const knowledge = await readFile(path.join(root, ".agents", "CHEATCODES.md"), "utf8");
    assert.equal(knowledge.includes("No, that is wrong"), false);
    assert.equal(knowledge.includes("repository adapter is required"), false);
    assert.equal(knowledge.includes("cheatcodes/"), false);
    assert.match(knowledge, /session:session-1#records=/);
    const parsed = parseKnowledgeMarkdown(knowledge);
    const stamp = new Date((await stat(path.join(sessions, "one.jsonl"))).mtimeMs).toISOString();
    assert.equal(parsed[0]!.date, stamp);
    const tempFiles = (await readdir(root)).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(tempFiles, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the knowledge pointer is appended once and replaces the legacy pointer", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const legacy = "## Project knowledge\n\nStart with `.cheatcodes/knowledge/index.md`. Check concept status before relying on a draft.";
    await writeFile(path.join(root, "AGENTS.md"), `# Agents\n\n${legacy}\n`);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.equal(agents.includes(".cheatcodes/knowledge"), false);
    assert.equal(agents.match(/## Project knowledge/g)?.length, 1);
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    assert.equal((await readFile(path.join(root, "AGENTS.md"), "utf8")), agents);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("an existing AGENTS.md keeps its content and gains the pointer exactly once", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    await writeFile(path.join(root, "AGENTS.md"), "# My project\n\nBe nice to the code.\n");
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.equal(agents.startsWith("# My project\n\nBe nice to the code.\n"), true);
    assert.equal(agents.match(/## Project knowledge/g)?.length, 1);
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8"), agents);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("secret redaction covers common credential shapes", () => {
  const redacted = redactSecrets([
    "token Bearer abc.def.ghi-jk",
    "key sk_live_ABCDEFGHIJKLmnop",
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12",
    "AKIAIOSFODNN7EXAMPLE",
    "https://user:hunter2@example.com/repo",
    "MY_API_KEY = super-secret-value",
    "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
  ].join("\n"));
  assert.equal(redacted.includes("Bearer abc"), false);
  assert.equal(redacted.includes("sk_live_ABCDEFGHIJKLmnop"), false);
  assert.equal(redacted.includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12"), false);
  assert.equal(redacted.includes("AKIAIOSFODNN7EXAMPLE"), false);
  assert.equal(redacted.includes("hunter2"), false);
  assert.equal(redacted.includes("super-secret-value"), false);
  assert.equal(redacted.includes("PRIVATE KEY-----\nabc"), false);
});

test("repository path normalization scopes paths to the project and redacts outside paths", () => {
  const root = "/repo";
  assert.equal(normalizeRepositoryPath("src/a.ts", "key", [root], root), "repo://key/src/a.ts");
  assert.equal(normalizeRepositoryPath("/repo/src/a.ts", "key", [root], root), "repo://key/src/a.ts");
  assert.equal(normalizeRepositoryPath("/etc/passwd", "key", [root], root), undefined);
  assert.equal(normalizeRepositoryPath("", "key", [root], root), undefined);
});

test("partial final JSONL lines are not committed until complete", () => {
  const complete = fixture("/repo", "s9");
  const parsed = parseJsonlBytes(Buffer.from(complete + `{"type":"message","id":"u2"`, { file: "f.jsonl" }));
  assert.equal(parsed.sessionId, "s9");
  assert.equal(parsed.records.some((record) => record.id === "u2"), false);
  assert.equal(complete.includes("u2"), false);
  const reparsed = parseJsonlBytes(Buffer.from(complete), { file: "f.jsonl" });
  assert.equal(reparsed.completeOffset, parsed.completeOffset);
  assert.equal(reparsed.completeSha256, parsed.completeSha256);
});

test("Claude Code JSONL is normalized at the session boundary", () => {
  const metadata = { sessionId: "claude-session", cwd: "/repo", version: "1.0.58" };
  const parsed = parseJsonlBytes(Buffer.from([
    line({ ...metadata, type: "user", uuid: "u1", parentUuid: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "Please run the repository tests before finishing." } }),
    line({ ...metadata, type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } }] } }),
    line({ ...metadata, type: "user", uuid: "t1", parentUuid: "a1", timestamp: "2026-01-01T00:00:02Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "all tests passed" }] } }),
    line({ ...metadata, type: "assistant", uuid: "a2", parentUuid: "t1", timestamp: "2026-01-01T00:00:03Z", message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "The repository tests pass." }] } }),
  ].join("")), { file: "claude.jsonl" });

  assert.equal(parsed.sessionId, "claude-session");
  assert.deepEqual(parsed.records.map((record) => record.id), ["u1", "t1", "a2"]);
  assert.deepEqual(parsed.branches[0]!.map((record) => record.id), ["u1", "t1", "a2"]);
  assert.equal(parsed.records[1]!.receipt!.tool, "Bash");
  assert.equal(parsed.records[1]!.receipt!.command, "npm test");
});

test("branch reconstruction follows parent chains across versions", () => {
  const record = (id: string, parentId: string | null, role: string) =>
    line({ type: "message", id, parentId, timestamp: "2026-01-01T00:00:00Z", message: { role, stopReason: "stop", content: [{ type: "text", text: `substantive message text for ${id}` }] } });
  const v1 = parseJsonlBytes(Buffer.from([
    line({ type: "session", id: "s", cwd: "/repo" }),
    record("a", null, "user"),
    record("b", undefined, "assistant"),
  ].join("")), { file: "v1.jsonl" });
  assert.equal(v1.branches.length, 1);
  assert.equal(v1.branches[0]!.length, 2);
  assert.equal(v1.branches[0]![1]!.parentId, v1.branches[0]![0]!.id);

  const v3 = parseJsonlBytes(Buffer.from([
    line({ type: "session", version: 3, id: "s", cwd: "/repo" }),
    record("a", null, "user"),
    record("b", "a", "assistant"),
    record("c", "b", "user"),
  ].join("")), { file: "v3.jsonl" });
  assert.equal(v3.branches.length, 1);
  assert.deepEqual(v3.branches[0]!.map((item) => item.id), ["a", "b", "c"]);
});

test("repository-boundary filtering skips sessions from other roots", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    await writeFile(path.join(sessions, "foreign.jsonl"), fixture("/elsewhere", "foreign-1"));
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    const result = await runProject({ root, env, curator: fakeCurator(calls) });
    assert.equal(result.changedFiles, 1);
    await stat(path.join(root, ".agents", "CHEATCODES.md"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

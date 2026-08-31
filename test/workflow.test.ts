import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deriveProjectKey, knowledgeFilePath, loadGlobalConfig } from "../src/config.js";
import { parseKnowledgeMarkdown } from "../src/concept.js";
import { loadCurationState } from "../src/curation-state.js";
import { maintainProject } from "../src/maintain.js";
import { buildManifest, commitManifestCursors, manifestPath, readManifest } from "../src/workflow/manifests.js";
import { createWorkflowTools } from "../src/workflow/tools.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }

async function fixtureProject(): Promise<{ root: string; env: NodeJS.ProcessEnv; clean: () => Promise<void> }> {
  const root = await temporary();
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, "ep.jsonl"), [
    line({ type: "session", version: 3, id: "ep-1", timestamp: "2026-01-01T00:00:00Z", cwd: root }),
    line({ type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "The report export must batch rows by fiscal quarter or the ledger reconciliation fails on large datasets." }] } }),
    line({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "npm test" } }] } }),
    line({ type: "message", id: "t1", parentId: "a1", timestamp: "2026-01-01T00:00:03Z", message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "3 failing" }], isError: false, exitCode: 1, details: {} } }),
    line({ type: "message", id: "u2", parentId: "t1", timestamp: "2026-01-01T00:00:04Z", message: { role: "user", content: [{ type: "text", text: "No, batch by fiscal quarter first, then rerun the export." }] } }),
    line({ type: "message", id: "a2", parentId: "u2", timestamp: "2026-01-01T00:00:05Z", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "c2", name: "edit", arguments: { path: "src/export.ts", patch: "batch by quarter" } }] } }),
    line({ type: "message", id: "t2", parentId: "a2", timestamp: "2026-01-01T00:00:06Z", message: { role: "toolResult", toolCallId: "c2", toolName: "edit", content: [{ type: "text", text: "Edited src/export.ts" }], isError: false, details: {} } }),
    line({ type: "message", id: "a3", parentId: "t2", timestamp: "2026-01-01T00:00:07Z", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "c3", name: "bash", arguments: { command: "npm test" } }] } }),
    line({ type: "message", id: "t3", parentId: "a3", timestamp: "2026-01-01T00:00:08Z", message: { role: "toolResult", toolCallId: "c3", toolName: "bash", content: [{ type: "text", text: "9 passing" }], isError: false, exitCode: 0, details: {} } }),
    line({ type: "message", id: "a4", parentId: "t3", timestamp: "2026-01-01T00:00:09Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Fixed. The export now batches rows by fiscal quarter before reconciliation, and the tests pass." }] } }),
  ].join(""));
  const { env } = await writeGlobalConfig({ inputs: [sessions] });
  await writeFile(path.join(root, "src.ts"), "export const quarter = 4;\n");
  return { root, env, clean: () => rm(root, { recursive: true, force: true }) };
}

test("buildManifest produces a content-addressed immutable manifest and commits cursors forward only", async () => {
  const { root, env, clean } = await fixtureProject();
  try {
    const first = await buildManifest({ root, env });
    assert.ok(first.manifest, "manifest built from pending episodes");
    assert.equal(first.manifest.packets.length, 1);
    assert.ok(first.manifest.packets[0]!.signals.includes("correction"));
    const again = await buildManifest({ root, env });
    assert.equal(again.manifest?.id, first.manifest.id, "re-collection is idempotent on content");
    const stored = await readManifest(root, first.manifest.id);
    assert.equal(stored?.id, first.manifest.id);
    assert.equal(await readManifest(root, "../../etc/passwd"), undefined, "non-hash ids never touch the filesystem");
    assert.equal(await readManifest(root, "f".repeat(40)), undefined);
    const committed = await commitManifestCursors({ root, env, manifest: first.manifest });
    assert.equal(committed, Object.keys(first.manifest.cursors).length);
    const replayed = await buildManifest({ root, env });
    assert.equal(replayed.manifest, undefined, "cursors consumed; nothing pending");
    // committed cursor is never moved backwards by a stale manifest
    const stale = await commitManifestCursors({ root, env, manifest: { ...first.manifest, cursors: Object.fromEntries(Object.entries(first.manifest.cursors).map(([file, cursor]) => [file, { ...cursor, committedOffset: 0 }])) } });
    assert.equal(stale, Object.keys(first.manifest.cursors).length);
    const { loadGlobalState } = await import("../src/state.js");
    const projectKey = await deriveProjectKey(root);
    const state = await loadGlobalState(env);
    assert.ok(Object.values(state.projects[projectKey]!.files).every((cursor) => cursor.committedOffset > 0));
  } finally { await clean(); }
});

async function correctionArcSession(file: string, marker: string): Promise<string> {
  const arc = (tag: string) => [
    line({ type: "message", id: `u-${tag}`, parentId: null, timestamp: `2026-01-01T00:0${tag}:00Z`.replace(":000", "0:00"), message: { role: "user", content: [{ type: "text", text: `Batch the ${marker} ${tag} export by fiscal quarter or reconciliation fails.` }] } }),
    line({ type: "message", id: `a-${tag}`, parentId: `u-${tag}`, timestamp: `2026-01-01T00:0${tag}:01Z`, message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: `c-${tag}`, name: "bash", arguments: { command: "npm test" } }] } }),
    line({ type: "message", id: `t-${tag}`, parentId: `a-${tag}`, timestamp: `2026-01-01T00:0${tag}:02Z`, message: { role: "toolResult", toolCallId: `c-${tag}`, toolName: "bash", content: [{ type: "text", text: "2 failing" }], isError: false, exitCode: 1, details: {} } }),
    line({ type: "message", id: `v-${tag}`, parentId: `t-${tag}`, timestamp: `2026-01-01T00:0${tag}:03Z`, message: { role: "user", content: [{ type: "text", text: `No, for ${marker} ${tag} batch quarters before the export runs.` }] } }),
    line({ type: "message", id: `b-${tag}`, parentId: `v-${tag}`, timestamp: `2026-01-01T00:0${tag}:04Z`, message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: `d-${tag}`, name: "edit", arguments: { path: `src/${marker}-${tag}.ts`, patch: "batch quarters" } }] } }),
    line({ type: "message", id: `w-${tag}`, parentId: `b-${tag}`, timestamp: `2026-01-01T00:0${tag}:05Z`, message: { role: "toolResult", toolCallId: `d-${tag}`, toolName: "edit", content: [{ type: "text", text: "Edited" }], isError: false, details: {} } }),
    line({ type: "message", id: `x-${tag}`, parentId: `w-${tag}`, timestamp: `2026-01-01T00:0${tag}:06Z`, message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: `Done. ${marker} ${tag} batches quarters before export; tests pass.` }] } }),
  ];
  return [
    line({ type: "session", version: 3, id: file, timestamp: "2026-01-01T00:00:00Z", cwd: file }),
    ...arc("1"), ...arc("2"),
  ].join("");
}

test("buildManifest leaves truncated files uncommitted so capped episodes rescan", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    for (let index = 1; index <= 5; index++) {
      await writeFile(path.join(sessions, `s${index}.jsonl`), await correctionArcSession(`cap-${index}`, `widget${index}`));
    }
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const first = await buildManifest({ root, env });
    assert.ok(first.manifest, "manifest built");
    assert.equal(first.manifest.packets.length, 8, "cap bounds the packet count");
    assert.equal(Object.keys(first.manifest.cursors).length, 4, "only fully evaluated files commit cursors");
    await commitManifestCursors({ root, env, manifest: first.manifest });
    const second = await buildManifest({ root, env });
    assert.ok(second.manifest, "truncated files are re-evaluated after commit");
    assert.equal(second.manifest.packets.length, 2, "remaining episodes are curated next");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workflow tools resolve evidence, search, inspect, verify, and stage", async () => {
  const { root, env, clean } = await fixtureProject();
  try {
    const toolEnv = { ...env, CHEATCODES_PROJECT_ROOT: root };
    const tools = new Map(createWorkflowTools(toolEnv).map((tool) => [tool.name, tool]));
    const run = (name: string, params: unknown) => tools.get(name)!.execute("id", params as never, undefined, undefined, undefined as never) as Promise<{ content: Array<{ text: string }>; isError?: boolean; details: unknown }>;
    const build = await buildManifest({ root, env });
    const manifestId = build.manifest!.id;
    const packetId = build.manifest!.packets[0]!.id;

    const evidence = await run("load_evidence_episode", { manifestId, packetId });
    assert.ok(!evidence.isError);
    const payload = evidence.details as { evidence: unknown[]; closure: string };
    assert.equal(payload.closure, "assistant-settled");
    assert.ok(payload.evidence.length >= 2);
    const missing = await run("load_evidence_episode", { manifestId, packetId: "nope" });
    assert.equal(missing.isError, true);

    const search = await run("search_knowledge", { query: "quarterly export" });
    const searchPayload = search.details as { corpusRevision: string; results: unknown[] };
    assert.equal(searchPayload.results.length, 0, "empty corpus searches cleanly");

    const inspect = await run("inspect_project_fact", { path: "src.ts", pattern: "quarter" });
    const inspectPayload = inspect.details as { matchedLines: number; lines: Array<{ line: number; text: string }> };
    assert.equal(inspectPayload.matchedLines, 1);
    assert.equal(inspectPayload.lines[0]!.line, 1);
    const escape = await run("inspect_project_fact", { path: "../outside.txt" });
    assert.equal(escape.isError, true, "path escapes are rejected");

    const unlisted = await run("verify_command", { commandId: "rm -rf" });
    assert.equal(unlisted.isError, true);
    const commands = path.join(root, ".cheatcodes", "workflow", "commands.json");
    await mkdir(path.dirname(commands), { recursive: true });
    await writeFile(commands, JSON.stringify({ "list": { argv: ["node", "-e", "process.stdout.write('ok')"] } }));
    const verified = await run("verify_command", { commandId: "list" });
    const verifyPayload = verified.details as { status: string; exitCode: number; stdoutTail: string };
    assert.equal(verifyPayload.status, "exited");
    assert.equal(verifyPayload.stdoutTail, "ok");

    const { renderKnowledgeMarkdown, validateEntry } = await import("../src/concept.js");
    const seed = validateEntry({ id: "batch-quarter", title: "Batch exports by fiscal quarter", summary: "Batching rows by fiscal quarter is required before reconciliation.", body: "Export jobs must batch rows by fiscal quarter before reconciliation runs.", date: "2026-01-01", tags: ["export"], sources: ["ep-1"], kind: "procedure" });
    const corpus = renderKnowledgeMarkdown([seed]);
    await writeFile(knowledgeFilePath(root, loadGlobalConfig(env)!.knowledgeFile), corpus);
    const entries = parseKnowledgeMarkdown(corpus);
    const staleStage = await run("stage_knowledge_transaction", { transaction: { baseRevision: "stale", operations: [{ op: "keep", target: { id: entries[0]!.id, expectedDigest: "x" }, reason: "still valid" }] } });
    assert.equal(staleStage.isError, true);
    const staleDetails = staleStage.details as { reason: string; currentRevision: string };
    assert.equal(staleDetails.reason, "stale-revision");
    assert.ok(staleDetails.currentRevision.length > 0);

    const { corpusRevision, entryDigest } = await import("../src/concept.js");
    const revision = corpusRevision(entries);
    const op = { op: "update", target: { id: entries[0]!.id, expectedDigest: entryDigest(entries[0]) }, entry: { title: entries[0]!.title, summary: "Batching by fiscal quarter is mandatory before reconciliation.", body: entries[0]!.body, date: "2026-01-01", tags: ["export"], sources: ["ep-1"] } };
    const staged = await run("stage_knowledge_transaction", { transaction: { baseRevision: revision, packetIds: [packetId], operations: [op] } });
    assert.ok(!staged.isError, staged.content[0]?.text);
    const stagedDetails = staged.details as { status: string; transactionId: string };
    assert.equal(stagedDetails.status, "staged");
    const projectKey = await deriveProjectKey(root);
    const state = await loadCurationState(env, projectKey);
    assert.equal(state.maintenanceCursor?.pendingTransaction?.transactionId, stagedDetails.transactionId);

    const committed = await maintainProject({ env, root, mode: "resume" });
    assert.ok(committed.committed, "host applies staged transaction after terminal success");
    const updated = parseKnowledgeMarkdown(await readFile(knowledgeFilePath(root, loadGlobalConfig(env)!.knowledgeFile), "utf8"));
    assert.match(updated[0]!.summary, /mandatory/);
  } finally { await clean(); }
});

test("inspect_project_fact rejects symlink escapes", async () => {
  const { root, env, clean } = await fixtureProject();
  try {
    const outside = path.join(os.tmpdir(), `cheatcodes-escape-${Date.now()}.txt`);
    await writeFile(outside, "secret\n");
    await symlink(outside, path.join(root, "link.txt"));
    const tools = new Map(createWorkflowTools({ ...env, CHEATCODES_PROJECT_ROOT: root }).map((tool) => [tool.name, tool]));
    const result = await tools.get("inspect_project_fact")!.execute("id", { path: "link.txt" } as never, undefined, undefined, undefined as never) as { isError?: boolean };
    assert.equal(result.isError, true);
    await rm(outside, { force: true });
  } finally { await clean(); }
});

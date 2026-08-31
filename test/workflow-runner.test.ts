import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import { parseJsonlBytes, WORKER_ORIGIN } from "../src/jsonl.js";
import { runProject } from "../src/run.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

// Choreograph is a versioned git dependency published as raw TypeScript. The
// specifier is assembled at runtime so `tsc` does not try to resolve it.
const choreographModule = ["choreograph", "src", "index.ts"].join("/");
type ExtensionFactory = (pi: Record<string, unknown>, workflowsRoot?: string) => void;
const choreograph: ExtensionFactory | undefined = await import(choreographModule)
  .then((module) => (module as { default: ExtensionFactory }).default)
  .catch(() => undefined);

interface Notice { message: string; level?: string }
interface Harness {
  pi: Record<string, unknown>;
  tools: Map<string, { execute: (id: string, params: Record<string, unknown>, signal?: unknown, onProgress?: unknown, ctx?: unknown) => Promise<Record<string, unknown>> }>;
  commands: Map<string, { handler: (target: string, ctx: unknown) => Promise<unknown> }>;
  handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
  entries: Array<{ type: string; customType?: string; data?: Record<string, unknown> }>;
  sent: string[];
  activeTools: Set<string>;
  notices: Notice[];
  ctx: () => Record<string, unknown>;
}

function harness(): Harness {
  const tools = new Map();
  const commands = new Map();
  const handlers = new Map();
  const entries: Harness["entries"] = [];
  const sent: string[] = [];
  const activeTools = new Set(["read", "bash"]);
  const notices: Notice[] = [];
  const ctx = () => ({
    ui: { setStatus: () => {}, notify: (message: string, level?: string) => notices.push({ message, level }) },
    sessionManager: { getBranch: () => entries },
  });
  const pi: Record<string, unknown> = {
    registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never),
    registerCommand: (name: string, command: { handler: (target: string, ctx: unknown) => Promise<unknown> }) => commands.set(name, command),
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(event, handler),
    getActiveTools: () => [...activeTools],
    setActiveTools: (names: string[]) => { activeTools.clear(); names.forEach((name) => activeTools.add(name)); },
    appendEntry: (customType: string, data: Record<string, unknown>) => entries.push({ type: "custom", customType, data }),
    sendUserMessage: async (message: string) => { sent.push(message); },
  };
  return { pi, tools, commands, handlers, entries, sent, activeTools, notices, ctx };
}

function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }

async function writeSpikeWorkflow(root: string): Promise<string> {
  const workflows = path.join(root, "workflows");
  const dir = path.join(workflows, "spike-run");
  await mkdir(path.join(dir, "steps"), { recursive: true });
  await mkdir(path.join(dir, "contracts"), { recursive: true });
  await writeFile(path.join(dir, "WORKFLOW.md"), [
    "---",
    "description: Two-task headless rollover spike.",
    "piVisibility: true",
    "legalTools: [read, bash]",
    "contracts:",
    "  deliverable: contracts/deliverable.schema.json",
    "steps:",
    "  - run: steps/frame.md",
    "    id: frame",
    "    done: [scope-recorded]",
    "  - run: steps/deliver.md",
    "    id: deliver",
    "    output: deliverable",
    "    done: [result-recorded]",
    "---",
    "",
    "# Spike",
    "",
    "Frame the scope, then deliver one evidenced finding.",
    "",
  ].join("\n"));
  await writeFile(path.join(dir, "steps", "frame.md"), "# Frame\n\nRecord the scope in the checkpoint summary.\n");
  await writeFile(path.join(dir, "steps", "deliver.md"), "# Deliver\n\nReport one finding with evidence.\n");
  await writeFile(path.join(dir, "contracts", "deliverable.schema.json"), JSON.stringify({
    type: "object",
    required: ["finding", "evidence"],
    additionalProperties: false,
    properties: {
      finding: { type: "string", minLength: 1 },
      evidence: { type: "array", items: { type: "string" }, maxItems: 8 },
    },
  }, null, 2));
  return workflows;
}

test("two-task workflow rolls over headlessly through the choreograph extension", { skip: !choreograph }, async () => {
  const root = await temporary();
  try {
    const workflows = await writeSpikeWorkflow(root);
    const ext = harness();
    choreograph!(ext.pi, workflows);
    const ctx = ext.ctx();
    ext.handlers.get("session_start")!(undefined, ctx);
    const start = await ext.tools.get("workflow_start")!.execute("id", { name: "spike-run", target: root }, undefined, () => {}, ctx);
    assert.ok(!start.isError);
    await ext.handlers.get("agent_settled")!(undefined, ctx);
    assert.ok(ext.sent.length >= 1, "first position control message delivered");
    assert.match(ext.sent[0]!, /root\/frame/);

    const prompt1 = ext.handlers.get("before_agent_start")!({ systemPrompt: "base" }) as { systemPrompt: string };
    assert.ok(prompt1.systemPrompt.includes("Record the scope in the checkpoint summary."), "step instructions are inlined at position one");

    const transition = ext.tools.get("workflow_transition")!;
    const first = await transition.execute("id", {
      key: "root/frame",
      status: "completed",
      met: ["scope-recorded"],
      checkpoint: { summary: "Scope framed: verify the tokenizer behavior." },
    }, undefined, () => {}, ctx);
    assert.ok(!first.isError, String(first.content?.[0]?.text ?? ""));
    await ext.handlers.get("agent_settled")!(undefined, ctx);
    assert.match(ext.sent.at(-1)!, /root\/deliver/, "engine rolls over to the second position");

    const prompt2 = ext.handlers.get("before_agent_start")!({ systemPrompt: "base" }) as { systemPrompt: string };
    assert.ok(prompt2.systemPrompt.includes("Report one finding with evidence."), "step two instructions are inlined");
    assert.ok(!prompt2.systemPrompt.includes("Record the scope in the checkpoint summary."), "fresh position does not inherit prior step instructions");
    assert.ok(prompt2.systemPrompt.includes("Scope framed"), "declared checkpoint summaries orient the next position");

    const final = await transition.execute("id", {
      key: "root/deliver",
      status: "completed",
      met: ["result-recorded"],
      checkpoint: { summary: "Delivered.", data: { finding: "Tokenizer handles nested quotes.", evidence: ["src/parse.ts"] } },
    }, undefined, () => {}, ctx);
    assert.equal(final.terminate, true);
    assert.equal(final.details && (final.details as Record<string, unknown>).status, "completed");
    assert.equal(ext.entries.at(-1)?.data?.status, "completed");
    assert.match(ext.sent.at(-1)!, /Summarize completed workflow/, "terminal report is requested after completion");
    assert.ok(ext.entries.some((entry) => entry.customType === "choreograph"), "workflow snapshots persist in the session branch");
    assert.ok(![...ext.activeTools].includes("workflow_transition"), "idle tools return after completion");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AgentSessionRuntime replaces and rebinds sessions headlessly", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cheatcodes-runtime-"));
  try {
    const agentDir = path.join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }: { cwd: string; sessionManager: SessionManager; sessionStartEvent?: unknown }) => {
      const services = await createAgentSessionServices({ cwd, agentDir });
      return {
        ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent: sessionStartEvent as never })),
        services,
        diagnostics: services.diagnostics,
      };
    };
    const runtime = await createAgentSessionRuntime(createRuntime as never, {
      cwd: root,
      agentDir,
      sessionManager: SessionManager.create(root),
    });
    try {
      const first = runtime.session;
      assert.ok(first, "initial session created");
      const firstFile = first.sessionFile;
      const seen: string[] = [];
      let unsubscribe: (() => void) | undefined;
      const bind = async () => {
        unsubscribe?.();
        const session = runtime.session;
        unsubscribe = session.subscribe((event: { type: string }) => { seen.push(event.type); });
        return session;
      };
      const bound1 = await bind();
      await runtime.newSession();
      const second = await bind();
      assert.notEqual(second.sessionFile, firstFile, "rollover replaced the session file");
      assert.ok(second.sessionFile, "replacement session is bound");
      assert.equal(runtime.session, second);
      assert.ok(bound1.sessionFile);
      await unsubscribe?.();
      assert.ok(seen.length >= 0);
    } finally {
      await runtime.dispose();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workflow-engine session entries mark the session as a worker session", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, "worker.jsonl"), [
      line({ type: "session", version: 3, id: "wf-1", timestamp: "2026-01-01T00:00:00Z", cwd: root }),
      line({ type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "Qualify the adapter episode." }] } }),
      line({ type: "custom", customType: "choreograph", data: { status: "active" } }),
      line({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Accepted: the queue adapter procedure is durable and evidenced." }] } }),
    ].join(""));
    const parsed = parseJsonlBytes(await (await import("node:fs/promises")).readFile(path.join(sessions, "worker.jsonl")), { file: "worker.jsonl" });
    assert.equal(parsed.origin, WORKER_ORIGIN);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    const warnings: string[] = [];
    const result = await runProject({ root, env, curator: { async curate() { calls.count++; return { entries: [] }; } }, onWarning: (message) => warnings.push(message) });
    assert.equal(result.packets, 0);
    assert.equal(calls.count, 0);
    assert.ok(warnings.some((message) => /cheatcodes-worker session excluded/.test(message)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { cp, readFile as readFileFs, writeFile as writeFileFs, mkdir as mkdirFs } from "node:fs/promises";
import { deriveProjectKey, knowledgeFilePath, loadGlobalConfig } from "../src/config.js";
import { corpusRevision, parseKnowledgeMarkdown } from "../src/concept.js";
import { loadCurationState } from "../src/curation-state.js";
import { commitManifestCursors } from "../src/workflow/manifests.js";
import { maintainProject } from "../src/maintain.js";
import { createWorkflowTools } from "../src/workflow/tools.js";
import { buildManifest } from "../src/workflow/manifests.js";


async function writeCuratePackage(workflowsRoot: string): Promise<void> {
  await cp(path.resolve(import.meta.dirname ?? ".", "..", ".agents", "workflows", "cheatcodes-curate"), path.join(workflowsRoot, "cheatcodes-curate"), { recursive: true });
}

async function fixtureProject(): Promise<{ root: string; env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(path.join(tmpdir(), "cheatcodes-pipeline-"));
  const sessions = path.join(root, "sessions");
  await mkdirFs(sessions, { recursive: true });
  await writeFileFs(path.join(sessions, "ep.jsonl"), [
    line({ type: "session", version: 3, id: "ep-1", timestamp: "2026-01-01T00:00:00Z", cwd: root }),
    line({ type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "The report export must batch rows by fiscal quarter or the ledger reconciliation fails on large datasets. Make the export test pass." }] } }),
    line({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "npm test" } }] } }),
    line({ type: "message", id: "t1", parentId: "a1", timestamp: "2026-01-01T00:00:03Z", message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "1 failing: export does not batch rows" }], isError: false, exitCode: 1, details: {} } }),
    line({ type: "message", id: "u2", parentId: "t1", timestamp: "2026-01-01T00:00:04Z", message: { role: "user", content: [{ type: "text", text: "No, batch by fiscal quarter first, then rerun the export." }] } }),
    line({ type: "message", id: "a2", parentId: "u2", timestamp: "2026-01-01T00:00:05Z", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "c2", name: "edit", arguments: { path: "src/export.ts", patch: "batch rows by fiscal quarter" } }] } }),
    line({ type: "message", id: "t2", parentId: "a2", timestamp: "2026-01-01T00:00:06Z", message: { role: "toolResult", toolCallId: "c2", toolName: "edit", content: [{ type: "text", text: "Edited src/export.ts" }], isError: false, details: {} } }),
    line({ type: "message", id: "a3", parentId: "t2", timestamp: "2026-01-01T00:00:07Z", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "c3", name: "bash", arguments: { command: "npm test" } }] } }),
    line({ type: "message", id: "t3", parentId: "a3", timestamp: "2026-01-01T00:00:08Z", message: { role: "toolResult", toolCallId: "c3", toolName: "bash", content: [{ type: "text", text: "9 passing" }], isError: false, exitCode: 0, details: {} } }),
    line({ type: "message", id: "a4", parentId: "t3", timestamp: "2026-01-01T00:00:09Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Fixed. The export now batches rows by fiscal quarter before reconciliation, and the tests pass." }] } }),
  ].join(""));
  const { env } = await writeGlobalConfig({ inputs: [sessions] });
  await writeFileFs(path.join(root, "src.ts"), "export const quarter = 4;\n");
  await mkdirFs(path.join(root, ".agents"), { recursive: true });
  await writeFileFs(path.join(root, ".agents", "CHEATCODES.md"), "# CHEATCODES\n");
  return { root, env };
}

test("cheatcodes-curate completes through the engine; the host applies only after terminal success", { skip: !choreograph }, async () => {
  const { root, env } = await fixtureProject();
  try {
    const workflowsRoot = path.join(root, "workflows");
    await writeCuratePackage(workflowsRoot);
    const build = await buildManifest({ root, env });
    const manifest = build.manifest!;
    const packet = manifest.packets[0]!;
    const evidenceId = packet.evidence[0]!.id;

    const ext = harness();
    const toolEnv = { ...env, CHEATCODES_PROJECT_ROOT: root };
    ext.activeTools.clear();
    for (const name of ["read", "bash", "load_evidence_episode", "search_knowledge", "inspect_project_fact", "verify_command", "stage_knowledge_transaction"]) ext.activeTools.add(name);
    choreograph!(ext.pi, workflowsRoot);
    // Bind the bounded tools to the fixture project root.
    for (const tool of createWorkflowTools(toolEnv)) (ext.pi.registerTool as (t: unknown) => void)(tool);
    const ctx = ext.ctx();
    ext.handlers.get("session_start")!(undefined, ctx);
    // The runner invokes the slash command (prompt() handles extension commands headlessly).
    await ext.commands.get("cheatcodes-curate")!.handler(manifest.id, ctx);

    const transition = ext.tools.get("workflow_transition")!;
    const stageTool = ext.tools.get("stage_knowledge_transaction")!;
    const settleAndPrompt = async () => {
      await ext.handlers.get("agent_settled")!(undefined, ctx);
      return (ext.handlers.get("before_agent_start")!({ systemPrompt: "base" }) as { systemPrompt: string }).systemPrompt;
    };

    let prompt = await settleAndPrompt();
    assert.match(ext.sent[0]!, /root\/qualify/);
    const claim = "Export jobs must batch rows by fiscal quarter before reconciliation.";
    await transition.execute("id", {
      key: "root/qualify", status: "completed", met: ["verdicts-recorded"],
      checkpoint: { summary: "Qualified.", data: { verdicts: [{ packetId: packet.id, verdict: "accept", claims: [{ text: claim, evidence: [evidenceId] }] }] } },
    }, undefined, () => {}, ctx);

    prompt = await settleAndPrompt();
    assert.ok(prompt.includes("current truth"), "verify instructions reached position two");
    await transition.execute("id", {
      key: "root/verify", status: "completed", met: ["claims-verified"],
      checkpoint: { summary: "Verified.", data: { claims: [{ packetId: packet.id, text: claim, status: "current", reference: "src.ts:1" }] } },
    }, undefined, () => {}, ctx);

    prompt = await settleAndPrompt();
    assert.ok(prompt.includes("search_knowledge"), "reconcile instructions reached position three");
    const corpusText = await readFileFs(knowledgeFilePath(root, loadGlobalConfig(env)!.knowledgeFile), "utf8").catch(() => "");
    const baseRevision = corpusRevision(parseKnowledgeMarkdown(corpusText));
    const operation = { op: "create", entry: { title: "Batch exports by fiscal quarter", summary: "Export jobs must batch rows by fiscal quarter before reconciliation.", body: "Batching prevents ledger reconciliation failures on large datasets.", date: "2026-01-01", tags: ["export"], sources: [packet.sessionId], kind: "procedure" } };
    const transaction = { baseRevision, packetIds: [packet.id], operations: [operation] };
    await transition.execute("id", {
      key: "root/reconcile", status: "completed", met: ["transaction-proposed"],
      checkpoint: { summary: "Proposed.", data: transaction },
    }, undefined, () => {}, ctx);

    prompt = await settleAndPrompt();
    assert.ok(prompt.includes("adversarial"), "challenge runs as a fresh adversarial position");
    await transition.execute("id", {
      key: "root/challenge", status: "completed", met: ["mutation-decided"],
      checkpoint: { summary: "Approved.", data: { decision: "approved", rationale: "Claim is current, evidenced, and non-duplicate.", transaction } },
    }, undefined, () => {}, ctx);

    prompt = await settleAndPrompt();
    assert.ok(prompt.includes("stage_knowledge_transaction"), "stage instructions reached the final position");
    const receipt = await stageTool.execute("id", { transaction } as never, undefined, undefined, undefined as never) as { details: { status: string; transactionId: string; digest: string } };
    assert.equal(receipt.details.status, "staged");
    await transition.execute("id", {
      key: "root/stage", status: "completed", met: ["staged"],
      checkpoint: { summary: "Staged.", data: { status: "staged", transactionId: receipt.details.transactionId, digest: receipt.details.digest } },
    }, undefined, () => {}, ctx);
    await ext.handlers.get("agent_settled")!(undefined, ctx);

    const projectKey = await deriveProjectKey(root);
    const staged = await loadCurationState(env, projectKey);
    assert.ok(staged.maintenanceCursor?.pendingTransaction, "transaction is staged in host state");
    assert.equal(parseKnowledgeMarkdown(await readFileFs(knowledgeFilePath(root, loadGlobalConfig(env)!.knowledgeFile), "utf8").catch(() => "")).length, 0, "corpus is untouched before the host applies");

    const applied = await maintainProject({ env, root, mode: "resume" });
    assert.ok(applied.committed, "host applies the staged transaction after terminal success");
    const entries = parseKnowledgeMarkdown(await readFileFs(knowledgeFilePath(root, loadGlobalConfig(env)!.knowledgeFile), "utf8"));
    assert.equal(entries.length, 1);
    assert.match(entries[0]!.summary, /fiscal quarter/);
    await commitManifestCursors({ env, root, manifest });
    const replay = await buildManifest({ root, env });
    assert.equal(replay.manifest, undefined, "manifest cursors commit only after terminal success");
  } finally { await rm(root, { recursive: true, force: true }); }
});

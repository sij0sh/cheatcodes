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

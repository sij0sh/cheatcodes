import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { defineTool, type AgentToolResult, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { corpusRevision, entryDigest, parseKnowledgeMarkdown, type KnowledgeEntry } from "../concept.js";
import { deriveProjectKey, knowledgeFilePath, loadGlobalConfig } from "../config.js";
import { loadCurationState, saveCurationState } from "../curation-state.js";
import { parseKnowledgeTransaction, validateTransactionOperations, type KnowledgeTransaction } from "../transaction.js";
import { sha256 } from "../state.js";
import { readManifest } from "./manifests.js";

export const WORKFLOW_PROMPT_VERSION = "workflow-1";
const RESULT_LIMIT = 400;
const MAX_COMMAND_TIMEOUT_MS = 180_000;

const rootFor = (env: NodeJS.ProcessEnv): string => path.resolve(env.CHEATCODES_PROJECT_ROOT ?? process.cwd());

const text = (value: unknown, isError = false): AgentToolResult<unknown> =>
  ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: value, ...(isError ? { isError: true } : {}) });

async function loadCorpus(root: string, env: NodeJS.ProcessEnv): Promise<{ entries: KnowledgeEntry[]; revision: string }> {
  const global = await loadGlobalConfig(env);
  const file = knowledgeFilePath(root, global?.knowledgeFile);
  let entries: KnowledgeEntry[] = [];
  try { entries = parseKnowledgeMarkdown(await readFile(file, "utf8")); } catch { entries = []; }
  return { entries, revision: corpusRevision(entries) };
}

const overlap = (haystack: string, terms: readonly string[]): string[] =>
  terms.filter((term) => haystack.toLowerCase().includes(term));

export function createWorkflowTools(env: NodeJS.ProcessEnv = process.env): ToolDefinition[] {
  const loadEvidenceEpisode = defineTool({
    name: "load_evidence_episode",
    label: "Load evidence episode",
    description: "Load one harvested evidence episode from a workflow manifest. Accepts manifest and packet ids only; paths are rejected.",
    parameters: Type.Object({
      manifestId: Type.String({ description: "Content-addressed manifest id from the workflow target." }),
      packetId: Type.Optional(Type.String({ description: "Packet id inside the manifest. Omit to list the manifest's packet inventory." })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      const root = rootFor(env);
      const manifest = await readManifest(root, params.manifestId);
      if (!manifest) return text(`error: unknown manifest ${params.manifestId}`, true);
      if (params.packetId === undefined) {
        return text(manifest.packets.map((item) => ({ packetId: item.id, sessionId: item.sessionId, signals: item.signals, userIntent: item.userIntent })));
      }
      const packet = manifest.packets.find((item) => item.id === params.packetId);
      if (!packet) return text(`error: manifest ${params.manifestId} has no packet ${params.packetId}`, true);
      return text({
        packetId: packet.id, sessionId: packet.sessionId, closure: packet.closure, signals: packet.signals,
        signalReasons: packet.signalReasons, userIntent: packet.userIntent,
        finalAssistantSummary: packet.finalAssistantSummary, omittedEvidenceCount: packet.omittedEvidenceCount,
        evidence: packet.evidence, shortlist: packet.shortlist,
        ...(packet.updateCandidate ? { updateCandidate: packet.updateCandidate } : {}),
      });
    },
  });

  const searchKnowledge = defineTool({
    name: "search_knowledge",
    label: "Search knowledge",
    description: "Search the project corpus lexically. Returns full bodies, digests, and match reasons under hard caps.",
    parameters: Type.Object({
      query: Type.String({ minLength: 2, maxLength: 300 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      const root = rootFor(env);
      const { entries, revision } = await loadCorpus(root, env);
      const terms = params.query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
      const limit = params.limit ?? 5;
      const scored = entries.map((entry) => {
        const titleHits = overlap(entry.title, terms);
        const tagHits = overlap((entry.tags ?? []).join(" "), terms);
        const bodyHits = overlap(entry.body, terms);
        const score = titleHits.length * 3 + tagHits.length * 2 + bodyHits.length;
        const reasons = [
          ...(titleHits.length > 0 ? [`title:${titleHits.join(",")}`] : []),
          ...(tagHits.length > 0 ? [`tags:${tagHits.join(",")}`] : []),
          ...(bodyHits.length > 0 ? [`body:${bodyHits.length} term(s)`] : []),
        ];
        return { entry, score, reasons };
      }).filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
        .slice(0, limit);
      return text({
        corpusRevision: revision,
        results: scored.map(({ entry, reasons }) => ({
          id: entry.id, title: entry.title, summary: entry.summary, body: entry.body,
          digest: entryDigest(entry), matchReasons: reasons,
        })),
      });
    },
  });

  const inspectProjectFact = defineTool({
    name: "inspect_project_fact",
    label: "Inspect project fact",
    description: "Read lines from a file inside the verified project root. Rejects paths outside the root and symlink escapes.",
    parameters: Type.Object({
      path: Type.String({ description: "Path relative to the project root." }),
      pattern: Type.Optional(Type.String({ maxLength: 200, description: "Only return lines containing this text." })),
      maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: RESULT_LIMIT })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      const root = rootFor(env);
      const absolute = path.resolve(root, params.path);
      const rootReal = await realpath(root).catch(() => root);
      const targetReal = await realpath(absolute).catch(() => absolute);
      if (!targetReal.startsWith(rootReal + path.sep) && targetReal !== rootReal) {
        return text(`error: path escapes the project root`, true);
      }
      let content: string;
      try { content = await readFile(targetReal, "utf8"); }
      catch { return text(`error: cannot read ${params.path}`, true); }
      const allLines = content.split("\n");
      const cap = params.maxLines ?? 80;
      let lines = allLines.map((lineText, index) => ({ line: index + 1, text: lineText }));
      const total = lines.length;
      if (params.pattern) {
        const needle = params.pattern.toLowerCase();
        lines = lines.filter((item) => item.text.toLowerCase().includes(needle));
      }
      const truncated = lines.length > cap;
      return text({ path: params.path, totalLines: total, matchedLines: lines.length, truncated, lines: lines.slice(0, cap) });
    },
  });

  const verifyCommand = defineTool({
    name: "verify_command",
    label: "Verify command",
    description: "Run an allowlisted verification command by id. The host builds the argument vector; shell text is never accepted.",
    parameters: Type.Object({ commandId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      const root = rootFor(env);
      let allowlist: Record<string, { argv: string[]; timeoutMs?: number }>;
      try { allowlist = JSON.parse(await readFile(path.join(root, ".cheatcodes", "workflow", "commands.json"), "utf8")); }
      catch { return text("error: no verification command allowlist is configured", true); }
      const entry = allowlist[params.commandId];
      if (!entry || !Array.isArray(entry.argv) || entry.argv.length === 0 || !entry.argv.every((part) => typeof part === "string")) {
        return text(`error: command id ${params.commandId} is not allowlisted`, true);
      }
      const timeoutMs = Math.min(entry.timeoutMs ?? 120_000, MAX_COMMAND_TIMEOUT_MS);
      return await new Promise<AgentToolResult<unknown>>((resolve) => {
        const child = spawn(entry.argv[0]!, entry.argv.slice(1), { cwd: root, timeout: timeoutMs, killSignal: "SIGTERM", stdio: ["ignore", "pipe", "pipe"] });
        let out = ""; let err = ""; let timedOut = false;
        child.stdout.on("data", (chunk: Buffer) => { if (out.length < 65_536) out += String(chunk); });
        child.stderr.on("data", (chunk: Buffer) => { if (err.length < 65_536) err += String(chunk); });
        child.on("error", (error) => resolve(text({ commandId: params.commandId, status: "spawn-failed", error: String(error) }, true)));
        child.on("exit", (code, signal) => {
          if (signal === "SIGTERM" || signal === "SIGKILL") timedOut = true;
          resolve(text({
            commandId: params.commandId, status: timedOut ? "timeout" : "exited",
            exitCode: code, timedOut,
            stdoutTail: out.slice(-4_000), stderrTail: err.slice(-4_000),
          }));
        });
      });
    },
  });

  const stageKnowledgeTransaction = defineTool({
    name: "stage_knowledge_transaction",
    label: "Stage knowledge transaction",
    description: "Revalidate a challenged transaction against the live corpus and stage it into host state. Never edits the corpus; the host applies staged work only after terminal workflow success.",
    parameters: Type.Object({
      transaction: Type.Object({
        baseRevision: Type.String({ minLength: 1 }),
        packetIds: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
        operations: Type.Array(Type.Object({ op: Type.String() }, { additionalProperties: true }), { minItems: 1, maxItems: 8 }),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      const root = rootFor(env);
      const projectKey = await deriveProjectKey(root);
      const { entries, revision } = await loadCorpus(root, env);
      if (params.transaction.baseRevision !== revision) {
        return text({ status: "rejected", reason: "stale-revision", currentRevision: revision }, true);
      }
      const candidate = {
        transactionId: `wf-${sha256(JSON.stringify([projectKey, revision, params.transaction.operations])).slice(0, 24)}`,
        projectKey,
        baseRevision: params.transaction.baseRevision,
        packetIds: params.transaction.packetIds ?? [],
        promptVersion: WORKFLOW_PROMPT_VERSION,
        modelId: "workflow",
        operations: params.transaction.operations,
        createdAt: new Date().toISOString(),
      };
      let transaction: KnowledgeTransaction;
      try { transaction = parseKnowledgeTransaction(candidate); }
      catch (error) { return text({ status: "rejected", reason: "schema", detail: String(error).slice(0, 600) }, true); }
      const { issues } = validateTransactionOperations(entries, transaction.operations, projectKey);
      if (issues.length > 0) return text({ status: "rejected", reason: "validation", issues: issues.slice(0, 8) }, true);
      const state = await loadCurationState(env, projectKey);
      await saveCurationState(env, {
        ...state,
        maintenanceCursor: { at: new Date().toISOString(), lastTransactionId: state.maintenanceCursor?.lastTransactionId, pendingTransaction: transaction },
      });
      return text({ status: "staged", transactionId: transaction.transactionId, baseRevision: revision, digest: sha256(JSON.stringify(transaction.operations)) });
    },
  });

  return [loadEvidenceEpisode, searchKnowledge, inspectProjectFact, verifyCommand, stageKnowledgeTransaction];
}

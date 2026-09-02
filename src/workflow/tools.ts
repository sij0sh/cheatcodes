import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { defineTool, type AgentToolResult, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { corpusRevision, entryDigest, parseKnowledgeMarkdown, type KnowledgeEntry } from "../concept.js";
import { deriveProjectKey, knowledgeFilePath, loadGlobalConfig } from "../config.js";
import { updateCurationState } from "../curation-state.js";
import { parseKnowledgeTransaction, validateTransactionOperations, type KnowledgeTransaction } from "../transaction.js";
import { sha256 } from "../state.js";
import { readManifest } from "./manifests.js";
import { walkInventory, TREE_LIMITS } from "../inventory.js";

export const WORKFLOW_PROMPT_VERSION = "workflow-2";
const RESULT_LIMIT = 400;

const rootFor = (env: NodeJS.ProcessEnv): string => path.resolve(env.CHEATCODES_PROJECT_ROOT ?? process.cwd());

const text = (value: unknown, isError = false): AgentToolResult<unknown> =>
  ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: value, ...(isError ? { isError: true } : {}) });

export async function loadCorpus(root: string, env: NodeJS.ProcessEnv): Promise<{ entries: KnowledgeEntry[]; revision: string }> {
  const global = await loadGlobalConfig(env);
  const file = knowledgeFilePath(root, global?.knowledgeFile);
  let entries: KnowledgeEntry[] = [];
  try { entries = parseKnowledgeMarkdown(await readFile(file, "utf8")); } catch { entries = []; }
  return { entries, revision: corpusRevision(entries) };
}

const overlap = (haystack: string, terms: readonly string[]): string[] =>
  terms.filter((term) => haystack.toLowerCase().includes(term));

const TOOL_USAGE = "Set exactly one mode: query (search the corpus), manifestId (load a harvested evidence episode), path (read a project file), tree (bounded inventory), or transaction (stage a knowledge transaction).";

export function searchKnowledgeTool(env: NodeJS.ProcessEnv = process.env): ToolDefinition {
  return defineTool({
    name: "search_knowledge",
    label: "Search knowledge",
    description: `Search the project corpus lexically. One optional mode per call: load a harvested evidence episode (manifestId), read lines from a file inside the verified project root (path), bounded project inventory (tree), or stage a knowledge transaction (transaction). Modes are exclusive; ${TOOL_USAGE}`,
    parameters: Type.Object({
      query: Type.Optional(Type.String({ minLength: 2, maxLength: 300, description: "Search mode: whitespace-separated terms scored against titles, tags, and bodies." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "Search mode: maximum results (default 5)." })),
      manifestId: Type.Optional(Type.String({ description: "Episode mode: content-addressed manifest id from the workflow target. Omit packetId to list the manifest's packets." })),
      packetId: Type.Optional(Type.String({ description: "Episode mode: packet id inside the manifest." })),
      path: Type.Optional(Type.String({ description: "Fact mode: file path relative to the project root. Rejects paths outside the root and symlink escapes." })),
      pattern: Type.Optional(Type.String({ maxLength: 200, description: "Fact mode: only return lines containing this text." })),
      maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: RESULT_LIMIT, description: "Fact mode: line cap (default 80)." })),
      tree: Type.Optional(Type.Boolean({ description: "Tree mode: bounded inventory of the verified project root." })),
      transaction: Type.Optional(Type.Object({
        baseRevision: Type.String({ minLength: 1 }),
        packetIds: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
        operations: Type.Array(Type.Object({ op: Type.String() }, { additionalProperties: true }), { minItems: 1, maxItems: 8 }),
      }, { additionalProperties: false, description: "Stage mode: revalidate and stage this transaction. The host applies staged work only after terminal workflow success." })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      const root = rootFor(env);
      const modes = [
        params.transaction !== undefined && "stage",
        params.manifestId !== undefined && "episode",
        params.path !== undefined && "fact",
        params.query !== undefined && "search",
        params.tree === true && "tree",
      ].filter((mode): mode is string => typeof mode === "string");
      if (modes.length === 0) return text(TOOL_USAGE, true);
      if (modes.length > 1) return text(`error: ${modes.join(" and ")} cannot combine. ${TOOL_USAGE}`, true);
      switch (modes[0]) {
        case "search": return searchCorpus(root, env, params.query!, params.limit);
        case "episode": return loadEpisode(root, params.manifestId!, params.packetId);
        case "fact": return inspectFact(root, params.path!, params.pattern, params.maxLines);
        case "tree": return inspectTree(root);
        default: return stageTransaction(env, root, params.transaction!);
      }
    },
  });
}

async function searchCorpus(root: string, env: NodeJS.ProcessEnv, query: string, limit?: number): Promise<AgentToolResult<unknown>> {
  const { entries, revision } = await loadCorpus(root, env);
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  const cap = limit ?? 5;
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
    .slice(0, cap);
  return text({
    corpusRevision: revision,
    results: scored.map(({ entry, reasons }) => ({
      id: entry.id, title: entry.title, summary: entry.summary, body: entry.body,
      digest: entryDigest(entry), matchReasons: reasons,
    })),
  });
}

async function loadEpisode(root: string, manifestId: string, packetId?: string): Promise<AgentToolResult<unknown>> {
  const manifest = await readManifest(root, manifestId);
  if (!manifest) return text(`error: unknown manifest ${manifestId}`, true);
  if (packetId === undefined) {
    return text(manifest.packets.map((item) => ({ packetId: item.id, sessionId: item.sessionId, signals: item.signals, userIntent: item.userIntent })));
  }
  const packet = manifest.packets.find((item) => item.id === packetId);
  if (!packet) return text(`error: manifest ${manifestId} has no packet ${packetId}`, true);
  return text({
    packetId: packet.id, sessionId: packet.sessionId, closure: packet.closure, signals: packet.signals,
    signalReasons: packet.signalReasons, userIntent: packet.userIntent,
    finalAssistantSummary: packet.finalAssistantSummary, omittedEvidenceCount: packet.omittedEvidenceCount,
    evidence: packet.evidence, shortlist: packet.shortlist,
    ...(packet.updateCandidate ? { updateCandidate: packet.updateCandidate } : {}),
  });
}

async function inspectFact(root: string, filePath: string, pattern?: string, maxLines?: number): Promise<AgentToolResult<unknown>> {
  const absolute = path.resolve(root, filePath);
  const rootReal = await realpath(root).catch(() => root);
  const targetReal = await realpath(absolute).catch(() => absolute);
  if (!targetReal.startsWith(rootReal + path.sep) && targetReal !== rootReal) {
    return text(`error: path escapes the project root`, true);
  }
  let content: string;
  try { content = await readFile(targetReal, "utf8"); }
  catch { return text(`error: cannot read ${filePath}`, true); }
  const allLines = content.split("\n");
  const cap = maxLines ?? 80;
  let lines = allLines.map((lineText, index) => ({ line: index + 1, text: lineText }));
  const total = lines.length;
  if (pattern) {
    const needle = pattern.toLowerCase();
    lines = lines.filter((item) => item.text.toLowerCase().includes(needle));
  }
  const truncated = lines.length > cap;
  return text({ path: filePath, sha256: sha256(content), totalLines: total, matchedLines: lines.length, truncated, lines: lines.slice(0, cap) });
}

async function inspectTree(root: string): Promise<AgentToolResult<unknown>> {
  const inventory = await walkInventory(root);
  const entries = inventory.entries.map((entry) => (entry.bytes === undefined ? { path: entry.path } : { path: entry.path, bytes: entry.bytes }));
  const render = (list: { path: string; bytes?: number }[], truncated: boolean) => JSON.stringify({ root: inventory.root, totalFiles: inventory.totalFiles, truncated, entries: list });
  let list = entries;
  let truncated = inventory.truncated;
  while (render(list, truncated).length > TREE_LIMITS.bytes && list.length > 0) {
    list = list.slice(0, Math.floor(list.length * 0.9));
    truncated = true;
  }
  return text({ root: inventory.root, totalFiles: inventory.totalFiles, truncated, entries: list });
}

interface StageParams { baseRevision: string; packetIds?: string[]; operations: Array<{ op: string }> }

export type StagedTransaction =
  | { ok: true; transaction: KnowledgeTransaction }
  | { ok: false; reason: "schema" | "validation" | "project-busy"; detail?: string };

/** Shared staging tail (tool and host runner): parse, revalidate against the live corpus, park in curation state. */
export async function writePendingTransaction(
  env: NodeJS.ProcessEnv,
  projectKey: string,
  entries: readonly KnowledgeEntry[],
  baseRevision: string,
  packetIds: string[],
  operations: unknown[],
): Promise<StagedTransaction> {
  let parsed: KnowledgeTransaction;
  try {
    parsed = parseKnowledgeTransaction({
      transactionId: `wf-${sha256(JSON.stringify([projectKey, baseRevision, operations])).slice(0, 24)}`,
      projectKey,
      baseRevision,
      packetIds,
      promptVersion: WORKFLOW_PROMPT_VERSION,
      modelId: "workflow",
      operations: operations as KnowledgeTransaction["operations"],
      createdAt: new Date().toISOString(),
    });
  } catch (error) { return { ok: false, reason: "schema", detail: String(error).slice(0, 600) }; }
  const { issues } = validateTransactionOperations(entries, parsed.operations, projectKey);
  if (issues.length > 0) return { ok: false, reason: "validation", detail: issues.slice(0, 8).join("; ") };
  const updated = await updateCurationState(env, projectKey, (current) => ({
    ...current,
    maintenanceCursor: { at: new Date().toISOString(), lastTransactionId: current.maintenanceCursor?.lastTransactionId, pendingTransaction: parsed },
  }));
  if (!updated) {
    return { ok: false, reason: "project-busy", detail: "another cheatcodes run holds the project lock; retry staging later" };
  }
  return { ok: true, transaction: parsed };
}

async function stageTransaction(env: NodeJS.ProcessEnv, root: string, proposed: StageParams): Promise<AgentToolResult<unknown>> {
  const projectKey = await deriveProjectKey(root);
  const { entries, revision } = await loadCorpus(root, env);
  if (proposed.baseRevision !== revision) {
    return text({ status: "rejected", reason: "stale-revision", currentRevision: revision }, true);
  }
  const staged = await writePendingTransaction(env, projectKey, entries, proposed.baseRevision, proposed.packetIds ?? [], proposed.operations);
  if (!staged.ok) return text({ status: "rejected", reason: staged.reason, ...(staged.detail ? { detail: staged.detail } : {}) }, true);
  return text({ status: "staged", transactionId: staged.transaction.transactionId, baseRevision: revision, digest: sha256(JSON.stringify(staged.transaction.operations)) });
}

export function createWorkflowTools(env: NodeJS.ProcessEnv = process.env): ToolDefinition[] {
  return [searchKnowledgeTool(env)];
}

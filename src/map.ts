import { readFile, realpath } from "node:fs/promises";
import path from "node:path";import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import { deriveEntryId, entryDigest, normalizeTitleKey, type KnowledgeEntry } from "./concept.js";
import { deriveProjectKey, globalConfigPath, loadGlobalConfig } from "./config.js";
import { loadCurationState, updateCurationState } from "./curation-state.js";
import { commitKnowledgeTransaction, type CommitResult } from "./maintain.js";
import { ensureModelsFile } from "./models.js";
import { sha256 } from "./state.js";
import { finalUsage } from "./curate.js";
import { inventoryDigest } from "./inventory.js";
import { KnowledgeOperationSchema, validateTransactionOperations, type KnowledgeOperation, type KnowledgeTransaction } from "./transaction.js";
import { inspectProjectFactTool, inspectProjectTreeTool, loadCorpus, searchKnowledgeTool } from "./workflow/tools.js";

export const MAP_PROMPT_VERSION = "map-2";
export const MAP_FAMILIES = ["map:project-brief", "map:system", "map:capability"] as const;
export const MAX_MAP_OPERATIONS = 16;
export const REPO_SOURCE_PATTERN = /^repo:([^#\s]+)#sha256=([0-9a-f]{64})$/;

export const MAP_PROMPT = `You are the repository synthesizer for cheatcodes map.
You compress distributed repository truth into point entries grouped by three families.
You must inspect this repository yourself with the supplied tools; never rely on prior knowledge of the project.
Call submit_map_transaction exactly once as your final action.

Tools:
- inspect_project_tree: bounded file inventory. Always start here.
- inspect_project_fact: read lines from one file and receive its sha256.
- search_knowledge: search existing corpus entries.

Procedure:
1. Inventory the repository with inspect_project_tree.
2. Read package manifests, entry points, and configuration with inspect_project_fact.
3. Correlate what you read across files.
4. Submit one transaction: "create" operations for point entries that do not exist yet, "update" operations for entries in existingEntries (copy id and expectedDigest from that list).

Families. Emit one entry per point; never one entry per family:
- "map:project-brief": what the project observably is and does. Each entry states one point: the purpose, an actor, an input or output, or a major responsibility. Describe only what the code shows. Do not infer business motivation, target users, roadmap, or non-goals.
- "map:system": how the pieces fit together. Each entry states one point: the runtime or stack, an entry point, a major component, an important flow, or a storage or integration fact.
- "map:capability": what the system can actually do. Emit 3-8 entries. Include a capability only when knowing it changes a new engineer's mental model. Omit helpers, implementation details, and obvious CRUD variants.

Entry shape:
- title: a short stable phrase naming the point, unique across the submission and the corpus.
- summary: one sentence stating the point.
- body: the point as prose. No bullet lists and no Markdown headings.
- tags: exactly the family tag, for example ["map:capability"]. Never empty and never more than one.

Acceptance gates. Fail any gate and drop the entry:
- crossFileValue: the entry must synthesize at least two distinct repository files you inspected this session. If one obvious file already states the claim, the gate fails.
- singleSourceDuplicate: if one canonical file (for example README) already provides substantially the same explanation, the gate fails. Repo synthesis compresses distributed truth; it never mirrors documentation.
- Summarize concepts, not inventory. Never list files, dependencies, or commands as facts in themselves.

Provenance rules:
- Every operation's entry carries sources: at least two "repo:<relative-path>#sha256=<64-hex-digest>" strings.
- Cite only files you read with inspect_project_fact in this session, and copy the sha256 from that tool's output.
- Never set kind or date. Never invent paths or digests. Keep summaries and bodies free of Markdown headings reserved for the corpus format.
- Updates must keep the entry title; a point changes name by being recreated, never by being renamed.

Existing map entries whose titles are absent from your submission are retired, so submit every point that should survive.

Submit shape:
{"operations":[{"op":"create","entry":{"title":"Incremental session harvesting","summary":"...","body":"...","tags":["map:capability"],"sources":["repo:src/harvest.ts#sha256=<digest>","repo:src/jsonl.ts#sha256=<digest>"]}},{"op":"update","target":{"id":"<existingEntryId>","expectedDigest":"<existingEntryDigest>"},"entry":{"title":"Session scanning requires a platform-absolute cwd","summary":"...","body":"...","tags":["map:system"],"sources":["repo:src/a.ts#sha256=<digest>","repo:src/b.ts#sha256=<digest>"]}}]}

Zero operations is a valid outcome when the repository is too small or too obvious to be worth caching. Never fill a quota.`;

const MapSubmissionSchema = z.object({ operations: z.array(KnowledgeOperationSchema).max(MAX_MAP_OPERATIONS) }).strict();

export interface MapContext {
  entries: readonly KnowledgeEntry[];
  projectKey: string;
  existing: readonly MapEntryInput[];
}

export interface MapEntryInput {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  digest: string;
}

/** Tagged membership is the map marker; titles are free-form per point. */
export function isMapEntry(entry: KnowledgeEntry): boolean {
  return (entry.tags ?? []).some((tag) => (MAP_FAMILIES as readonly string[]).includes(tag));
}

export function validateMapOperations(value: unknown, context: MapContext): KnowledgeOperation[] {
  const parsed = MapSubmissionSchema.parse(value);
  const issues: string[] = [];
  const titles = new Set<string>();
  for (const [index, op] of parsed.operations.entries()) {
    const label = `operation[${index}](${op.op})`;
    if (op.op !== "create" && op.op !== "update") {
      issues.push(`${label}: only create and update operations are allowed`);
      continue;
    }
    const title = op.entry.title;
    if (titles.has(title)) issues.push(`${label}: duplicate title ${title}`);
    titles.add(title);
    if (op.entry.kind !== undefined) issues.push(`${label}: kind must be unset`);
    if (op.entry.date !== undefined) issues.push(`${label}: date must be unset`);
    const tags = op.entry.tags ?? [];
    if (tags.length !== 1 || !(MAP_FAMILIES as readonly string[]).includes(tags[0]!)) {
      issues.push(`${label}: tags must be exactly one of ${MAP_FAMILIES.join(", ")}`);
    }
    const sources = op.entry.sources ?? [];
    if (sources.length < 2) issues.push(`${label}: at least two repo: sources are required`);
    if (new Set(sources).size !== sources.length) issues.push(`${label}: sources must be distinct`);
    for (const source of sources) {
      if (!REPO_SOURCE_PATTERN.test(source)) issues.push(`${label}: malformed repo source ${source}`);
    }
    if (op.op === "update") {
      const current = context.existing.find((entry) => entry.id === op.target.id);
      if (current && normalizeTitleKey(current.title) !== normalizeTitleKey(title)) {
        issues.push(`${label}: update ${op.target.id} must keep the title "${current.title}"`);
      }
    }
  }
  const { issues: core } = validateTransactionOperations(context.entries, parsed.operations, context.projectKey);
  issues.push(...core);
  if (issues.length > 0) throw new Error(issues.join("; "));
  return parsed.operations;
}

function submitMapTransactionTool(context: MapContext, capture: { value?: unknown; error?: string }): ToolDefinition {
  return defineTool({
    name: "submit_map_transaction",
    label: "Submit map transaction",
    description: "Submit the final map operations for validation. Required as your last action.",
    parameters: Type.Object({
      operations: Type.Array(Type.Object({ op: Type.String() }, { additionalProperties: true }), { maxItems: MAX_MAP_OPERATIONS }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      try {
        validateMapOperations(params, context);
        capture.value = params;
        return { content: [{ type: "text", text: "Map operations recorded." }], details: {}, terminate: true };
      } catch (error) {
        capture.error = (error as Error).message;
        throw error;
      }
    },
  });
}

export interface RepoSourceIssue {
  source: string;
  reason: string;
}

export async function verifyRepoSourceList(root: string, sources: readonly string[]): Promise<RepoSourceIssue[]> {
  const issues: RepoSourceIssue[] = [];
  const rootReal = await realpath(root).catch(() => root);
  for (const source of sources) {
    const match = REPO_SOURCE_PATTERN.exec(source);
    if (!match) {
      issues.push({ source, reason: "malformed repo source" });
      continue;
    }
    const absolute = path.resolve(root, match[1]!);
    const targetReal = await realpath(absolute).catch(() => absolute);
    if (!targetReal.startsWith(rootReal + path.sep) && targetReal !== rootReal) {
      issues.push({ source, reason: "path escapes the project root" });
      continue;
    }
    let content: string;
    try { content = await readFile(targetReal, "utf8"); }
    catch {
      issues.push({ source, reason: "file is missing or unreadable" });
      continue;
    }
    if (sha256(content) !== match[2]) issues.push({ source, reason: "digest mismatch" });
  }
  return issues;
}

export async function verifyRepoSources(root: string, operations: readonly KnowledgeOperation[]): Promise<RepoSourceIssue[]> {
  const issues: RepoSourceIssue[] = [];
  for (const op of operations) {
    if (op.op !== "create" && op.op !== "update") continue;
    issues.push(...await verifyRepoSourceList(root, op.entry.sources ?? []));
  }
  return issues;
}

export function stampRepoVerification(operations: readonly KnowledgeOperation[], now = new Date()): KnowledgeOperation[] {
  return operations.map((op) => {
    if (op.op !== "create" && op.op !== "update") return op;
    return { ...op, entry: { ...op.entry, verifiedAt: now.toISOString(), verificationSources: [...(op.entry.sources ?? [])] } };
  });
}

/** The submitted set is authoritative: tagged entries left out are retired with stamped verification. */
export function planMapRetirements(
  existing: readonly KnowledgeEntry[],
  submitted: readonly KnowledgeOperation[],
  now = new Date(),
): KnowledgeOperation[] {
  const kept = new Set<string>();
  for (const op of submitted) {
    if (op.op === "create" || op.op === "update") kept.add(normalizeTitleKey(op.entry.title));
  }
  return existing
    .filter((entry) => !kept.has(normalizeTitleKey(entry.title)))
    .map((entry) => ({
      op: "delete" as const,
      target: { id: entry.id, expectedDigest: entryDigest(entry) },
      reason: "map point retired",
      verification: { verifiedAt: now.toISOString(), sources: entry.verificationSources ?? entry.sources ?? [] },
    }));
}

export function describeMapOperations(operations: readonly KnowledgeOperation[], projectKey: string): string[] {
  return operations.map((op) => {
    if (op.op === "create") return `create "${op.entry.title}" (${(op.entry.sources ?? []).length} source(s)) -> ${deriveEntryId(projectKey, op.entry.title)}`;
    if (op.op === "update") return `update ${op.target.id} "${op.entry.title}" (${(op.entry.sources ?? []).length} source(s))`;
    if (op.op === "delete") return `delete ${op.target.id} (${op.reason})`;
    return op.op;
  });
}

export interface MapSynthesisOutcome {
  operations?: KnowledgeOperation[];
  schemaInvalid: boolean;
  warning?: string;
  schemaRetries: number;
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface MapSynthesizerOptions { projectRoot: string; model: string; modelRuntime?: ModelRuntime; modelsPath?: string }

export class MapSynthesizer {
  private constructor(
    private readonly root: string,
    private readonly runtime: ModelRuntime,
    private readonly model: NonNullable<ReturnType<typeof resolveCliModel>["model"]>,
    private readonly thinkingLevel: NonNullable<ReturnType<typeof resolveCliModel>["thinkingLevel"]> | "medium",
    private readonly settings: SettingsManager,
    private readonly loader: DefaultResourceLoader,
    private readonly tools: ToolDefinition[],
  ) {}

  static async create(options: MapSynthesizerOptions): Promise<MapSynthesizer> {
    const runtime = options.modelRuntime ?? await ModelRuntime.create({ modelsPath: options.modelsPath });
    const resolved = resolveCliModel({ cliModel: options.model, modelRuntime: runtime });
    if (resolved.error || !resolved.model) throw new Error(resolved.error ?? `Model not found: ${options.model}`);
    if (resolved.warning) throw new Error(resolved.warning);
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const env: NodeJS.ProcessEnv = { ...process.env, CHEATCODES_PROJECT_ROOT: options.projectRoot };
    const tools = [inspectProjectTreeTool(env), inspectProjectFactTool(env), searchKnowledgeTool(env)];
    const loader = new DefaultResourceLoader({
      cwd: options.projectRoot,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: MAP_PROMPT,
      appendSystemPrompt: [],
      settingsManager: settings,
    });
    await loader.reload();
    return new MapSynthesizer(options.projectRoot, runtime, resolved.model, resolved.thinkingLevel ?? "medium", settings, loader, tools);
  }

  async synthesize(context: MapContext): Promise<MapSynthesisOutcome> {
    const startedAt = Date.now();
    let warning = "";
    let schemaRetries = 0;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const capture: { value?: unknown; error?: string } = {};
      const { session, modelFallbackMessage } = await createAgentSession({
        cwd: this.root,
        model: this.model,
        thinkingLevel: this.thinkingLevel,
        sessionManager: SessionManager.inMemory(this.root),
        resourceLoader: this.loader,
        modelRuntime: this.runtime,
        settingsManager: this.settings,
        customTools: [...this.tools, submitMapTransactionTool(context, capture)],
      });
      try {
        if (modelFallbackMessage) throw new Error(modelFallbackMessage);
        await session.prompt(JSON.stringify({ task: "Synthesize project map entries.", existingEntries: context.existing }));
        usage = finalUsage(session.messages) ?? usage;
        if (capture.value !== undefined) {
          return {
            operations: validateMapOperations(capture.value, context),
            schemaInvalid: false,
            schemaRetries,
            latencyMs: Date.now() - startedAt,
            usage,
          };
        }
        warning = capture.error ?? "model finished without calling submit_map_transaction";
      } catch (error) {
        warning = (error as Error).message;
      } finally {
        session.dispose();
      }
      schemaRetries = attempt + 1;
    }
    return { schemaInvalid: true, warning, schemaRetries, latencyMs: Date.now() - startedAt, usage };
  }
}

export interface MapRunOptions {
  root?: string;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface MapRunResult {
  status: "committed" | "planned" | "empty" | "failed";
  warning?: string;
  planned?: string[];
  committed?: CommitResult;
  schemaRetries?: number;
}

export async function runMap(options: MapRunOptions = {}): Promise<MapRunResult> {
  const env = options.env ?? process.env;
  const root = path.resolve(options.root ?? env.CHEATCODES_PROJECT_ROOT ?? process.cwd());
  const global = await loadGlobalConfig(env);
  if (!global) throw new Error(`No global config at ${globalConfigPath(env)}`);
  const projectKey = await deriveProjectKey(root);
  const { entries, revision } = await loadCorpus(root, env);
  const mapEntries = entries.filter(isMapEntry);
  const existing: MapEntryInput[] = mapEntries
    .map((entry) => ({ id: entry.id, title: entry.title, summary: entry.summary, tags: entry.tags ?? [], digest: entryDigest(entry) }));
  let modelsPath: string | undefined;
  try { modelsPath = await ensureModelsFile(env); }
  catch { /* no models registry; resolveCliModel falls back to the Pi default */ }
  const synthesizer = await MapSynthesizer.create({ projectRoot: root, model: global.model, modelsPath });
  const outcome = await synthesizer.synthesize({ entries, projectKey, existing });
  if (outcome.schemaInvalid || !outcome.operations) {
    return { status: "failed", warning: outcome.warning ?? "synthesis produced no valid map transaction", schemaRetries: outcome.schemaRetries };
  }
  const submitted = stampRepoVerification(outcome.operations);
  if (submitted.length === 0) return { status: "empty", warning: "no map entries warranted" };
  const operations = [...submitted, ...planMapRetirements(mapEntries, submitted)];
  const stale = await verifyRepoSources(root, operations);
  if (stale.length > 0) {
    return { status: "failed", warning: `stale or invalid repo sources: ${stale.map((issue) => `${issue.source} (${issue.reason})`).join("; ")}` };
  }
  if (options.dryRun) return { status: "planned", planned: describeMapOperations(operations, projectKey) };
  const transaction: KnowledgeTransaction = {
    transactionId: `map-${sha256(JSON.stringify([projectKey, revision, operations])).slice(0, 24)}`,
    projectKey,
    baseRevision: revision,
    packetIds: [],
    promptVersion: MAP_PROMPT_VERSION,
    modelId: global.model,
    operations,
    createdAt: new Date().toISOString(),
  };
  const committed = await commitKnowledgeTransaction(env, root, transaction);
  const mapCursor = { inventoryDigest: await inventoryDigest(root), checkedAt: new Date().toISOString() };
  const saved = await updateCurationState(env, transaction.projectKey, (current) => ({ ...current, mapCursor }));
  if (!saved) {
    return { status: "committed", committed, schemaRetries: outcome.schemaRetries, warning: "map cursor not updated; another run held the project lock" };
  }
  return { status: "committed", committed, schemaRetries: outcome.schemaRetries };
}

export type MapFreshness =
  | { state: "absent" }
  | { state: "fresh"; seeded?: boolean }
  | { state: "stale"; reason: string };

// Free checks only: cited-source digests (Gap F) and the inventory digest
// (Gap A). Never synthesizes; callers decide whether stale is worth a model run.
export async function checkMapFreshness(root: string, env: NodeJS.ProcessEnv): Promise<MapFreshness> {
  const { entries } = await loadCorpus(root, env);
  const mapEntries = entries.filter(isMapEntry);
  if (mapEntries.length === 0) return { state: "absent" };
  for (const entry of mapEntries) {
    const issues = await verifyRepoSourceList(root, entry.verificationSources ?? entry.sources ?? []);
    if (issues.length > 0) return { state: "stale", reason: "sources changed" };
  }
  const digest = await inventoryDigest(root);
  const projectKey = await deriveProjectKey(root);
  const state = await loadCurationState(env, projectKey);
  if (!state.mapCursor) {
    // D1: bounded lock wait, skip the cursor write on timeout; freshness stays readable.
    const seeded = await updateCurationState(env, projectKey, (current) => ({ ...current, mapCursor: { inventoryDigest: digest, checkedAt: new Date().toISOString() } }));
    return seeded ? { state: "fresh", seeded: true } : { state: "fresh" };
  }
  if (state.mapCursor.inventoryDigest !== digest) return { state: "stale", reason: "inventory changed" };
  await updateCurationState(env, projectKey, (current) => current.mapCursor
    ? { ...current, mapCursor: { ...current.mapCursor, checkedAt: new Date().toISOString() } }
    : current);
  return { state: "fresh" };
}

import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
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
import { deriveEntryId, entryDigest, type KnowledgeEntry } from "./concept.js";
import { deriveProjectKey, globalConfigPath, loadGlobalConfig } from "./config.js";
import { commitKnowledgeTransaction, type CommitResult } from "./maintain.js";
import { ensureModelsFile } from "./models.js";
import { sha256 } from "./state.js";
import { finalUsage } from "./curate.js";
import { KnowledgeOperationSchema, validateTransactionOperations, type KnowledgeOperation, type KnowledgeTransaction } from "./transaction.js";
import { inspectProjectFactTool, inspectProjectTreeTool, loadCorpus, searchKnowledgeTool } from "./workflow/tools.js";

export const MAP_PROMPT_VERSION = "map-1";
export const MAP_TITLES = ["Project brief", "System map", "Capability map"] as const;
export const REPO_SOURCE_PATTERN = /^repo:([^#\s]+)#sha256=([0-9a-f]{64})$/;

export const MAP_PROMPT = `You are the repository synthesizer for cheatcodes map.
You compress distributed repository truth into at most three corpus entries.
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
4. Submit one transaction: "create" operations for map entries that do not exist yet, "update" operations for entries in existingEntries (copy id and expectedDigest from that list).

Entry set (exact titles, at most one operation per title):
- "Project brief": what the project observably is and does. State purpose, primary actors, inputs and outputs, and major responsibilities. Describe only what the code shows. Do not infer business motivation, target users, roadmap, or non-goals.
- "System map": how the pieces fit together. State runtime and stack, entry points, major components, important flows, and storage or integrations.
- "Capability map": what the system can actually do. Prefer 3-8 capabilities. Include a capability only when knowing it changes a new engineer's mental model. Omit helpers, implementation details, and obvious CRUD variants.

Acceptance gates. Fail any gate and drop the entry:
- crossFileValue: the entry must synthesize at least two distinct repository files you inspected this session. If one obvious file already states the claim, the gate fails.
- singleSourceDuplicate: if one canonical file (for example README) already provides substantially the same explanation, the gate fails. Repo synthesis compresses distributed truth; it never mirrors documentation.
- Summarize concepts, not inventory. Never list files, dependencies, or commands as facts in themselves.

Provenance rules:
- Every operation's entry carries sources: at least two "repo:<relative-path>#sha256=<64-hex-digest>" strings.
- Cite only files you read with inspect_project_fact in this session, and copy the sha256 from that tool's output.
- Never set kind, tags, or date. Never invent paths or digests. Keep summaries and bodies free of Markdown headings reserved for the corpus format.

Submit shape:
{"operations":[{"op":"create","entry":{"title":"System map","summary":"...","body":"...","sources":["repo:src/run.ts#sha256=<digest>","repo:src/cli.ts#sha256=<digest>"]}},{"op":"update","target":{"id":"<existingEntryId>","expectedDigest":"<existingEntryDigest>"},"entry":{"title":"Project brief","summary":"...","body":"...","sources":["repo:src/a.ts#sha256=<digest>","repo:src/b.ts#sha256=<digest>"]}}]}

Zero operations is a valid outcome when the repository is too small or too obvious to be worth caching. Never fill a quota.`;

const MapSubmissionSchema = z.object({ operations: z.array(KnowledgeOperationSchema).max(3) }).strict();

export interface MapContext {
  entries: readonly KnowledgeEntry[];
  projectKey: string;
  existing: readonly MapEntryInput[];
}

export interface MapEntryInput {
  id: string;
  title: string;
  summary: string;
  digest: string;
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
    if (!(MAP_TITLES as readonly string[]).includes(title)) issues.push(`${label}: title must be one of ${MAP_TITLES.join(", ")}`);
    if (titles.has(title)) issues.push(`${label}: duplicate title ${title}`);
    titles.add(title);
    if (op.entry.kind !== undefined) issues.push(`${label}: kind must be unset`);
    if (op.entry.tags !== undefined && op.entry.tags.length > 0) issues.push(`${label}: tags must be unset`);
    if (op.entry.date !== undefined) issues.push(`${label}: date must be unset`);
    const sources = op.entry.sources ?? [];
    if (sources.length < 2) issues.push(`${label}: at least two repo: sources are required`);
    if (new Set(sources).size !== sources.length) issues.push(`${label}: sources must be distinct`);
    for (const source of sources) {
      if (!REPO_SOURCE_PATTERN.test(source)) issues.push(`${label}: malformed repo source ${source}`);
    }
    if (op.op === "update" && op.target.id !== deriveEntryId(context.projectKey, title)) {
      issues.push(`${label}: update target ${op.target.id} does not match the id derived from the title`);
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
      operations: Type.Array(Type.Object({ op: Type.String() }, { additionalProperties: true }), { maxItems: 3 }),
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

export async function verifyRepoSources(root: string, operations: readonly KnowledgeOperation[]): Promise<RepoSourceIssue[]> {
  const issues: RepoSourceIssue[] = [];
  const rootReal = await realpath(root).catch(() => root);
  for (const op of operations) {
    if (op.op !== "create" && op.op !== "update") continue;
    for (const source of op.entry.sources ?? []) {
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
  }
  return issues;
}

export function stampRepoVerification(operations: readonly KnowledgeOperation[], now = new Date()): KnowledgeOperation[] {
  return operations.map((op) => {
    if (op.op !== "create" && op.op !== "update") return op;
    return { ...op, entry: { ...op.entry, verifiedAt: now.toISOString(), verificationSources: [...(op.entry.sources ?? [])] } };
  });
}

export function describeMapOperations(operations: readonly KnowledgeOperation[], projectKey: string): string[] {
  return operations.map((op) => {
    if (op.op === "create") return `create "${op.entry.title}" (${(op.entry.sources ?? []).length} source(s)) -> ${deriveEntryId(projectKey, op.entry.title)}`;
    if (op.op === "update") return `update ${op.target.id} "${op.entry.title}" (${(op.entry.sources ?? []).length} source(s))`;
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
  const existing: MapEntryInput[] = entries
    .filter((entry) => (MAP_TITLES as readonly string[]).includes(entry.title))
    .map((entry) => ({ id: entry.id, title: entry.title, summary: entry.summary, digest: entryDigest(entry) }));
  let modelsPath: string | undefined;
  try { modelsPath = await ensureModelsFile(env); }
  catch { /* no models registry; resolveCliModel falls back to the Pi default */ }
  const synthesizer = await MapSynthesizer.create({ projectRoot: root, model: global.model, modelsPath });
  const outcome = await synthesizer.synthesize({ entries, projectKey, existing });
  if (outcome.schemaInvalid || !outcome.operations) {
    return { status: "failed", warning: outcome.warning ?? "synthesis produced no valid map transaction", schemaRetries: outcome.schemaRetries };
  }
  const operations = stampRepoVerification(outcome.operations);
  if (operations.length === 0) return { status: "empty", warning: "no map entries warranted" };
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
  return { status: "committed", committed, schemaRetries: outcome.schemaRetries };
}

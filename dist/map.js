import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createAgentSession, DefaultResourceLoader, defineTool, getAgentDir, ModelRuntime, resolveCliModel, SessionManager, SettingsManager, } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import { deriveEntryId, entryDigest } from "./concept.js";
import { deriveProjectKey, globalConfigPath, loadGlobalConfig } from "./config.js";
import { loadCurationState, saveCurationState } from "./curation-state.js";
import { commitKnowledgeTransaction } from "./maintain.js";
import { ensureModelsFile } from "./models.js";
import { sha256 } from "./state.js";
import { finalUsage } from "./curate.js";
import { inventoryDigest } from "./inventory.js";
import { KnowledgeOperationSchema, validateTransactionOperations } from "./transaction.js";
import { inspectProjectFactTool, inspectProjectTreeTool, loadCorpus, searchKnowledgeTool } from "./workflow/tools.js";
export const MAP_PROMPT_VERSION = "map-1";
export const MAP_TITLES = ["Project brief", "System map", "Capability map"];
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
export function validateMapOperations(value, context) {
    const parsed = MapSubmissionSchema.parse(value);
    const issues = [];
    const titles = new Set();
    for (const [index, op] of parsed.operations.entries()) {
        const label = `operation[${index}](${op.op})`;
        if (op.op !== "create" && op.op !== "update") {
            issues.push(`${label}: only create and update operations are allowed`);
            continue;
        }
        const title = op.entry.title;
        if (!MAP_TITLES.includes(title))
            issues.push(`${label}: title must be one of ${MAP_TITLES.join(", ")}`);
        if (titles.has(title))
            issues.push(`${label}: duplicate title ${title}`);
        titles.add(title);
        if (op.entry.kind !== undefined)
            issues.push(`${label}: kind must be unset`);
        if (op.entry.tags !== undefined && op.entry.tags.length > 0)
            issues.push(`${label}: tags must be unset`);
        if (op.entry.date !== undefined)
            issues.push(`${label}: date must be unset`);
        const sources = op.entry.sources ?? [];
        if (sources.length < 2)
            issues.push(`${label}: at least two repo: sources are required`);
        if (new Set(sources).size !== sources.length)
            issues.push(`${label}: sources must be distinct`);
        for (const source of sources) {
            if (!REPO_SOURCE_PATTERN.test(source))
                issues.push(`${label}: malformed repo source ${source}`);
        }
        if (op.op === "update" && op.target.id !== deriveEntryId(context.projectKey, title)) {
            issues.push(`${label}: update target ${op.target.id} does not match the id derived from the title`);
        }
    }
    const { issues: core } = validateTransactionOperations(context.entries, parsed.operations, context.projectKey);
    issues.push(...core);
    if (issues.length > 0)
        throw new Error(issues.join("; "));
    return parsed.operations;
}
function submitMapTransactionTool(context, capture) {
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
            }
            catch (error) {
                capture.error = error.message;
                throw error;
            }
        },
    });
}
export async function verifyRepoSourceList(root, sources) {
    const issues = [];
    const rootReal = await realpath(root).catch(() => root);
    for (const source of sources) {
        const match = REPO_SOURCE_PATTERN.exec(source);
        if (!match) {
            issues.push({ source, reason: "malformed repo source" });
            continue;
        }
        const absolute = path.resolve(root, match[1]);
        const targetReal = await realpath(absolute).catch(() => absolute);
        if (!targetReal.startsWith(rootReal + path.sep) && targetReal !== rootReal) {
            issues.push({ source, reason: "path escapes the project root" });
            continue;
        }
        let content;
        try {
            content = await readFile(targetReal, "utf8");
        }
        catch {
            issues.push({ source, reason: "file is missing or unreadable" });
            continue;
        }
        if (sha256(content) !== match[2])
            issues.push({ source, reason: "digest mismatch" });
    }
    return issues;
}
export async function verifyRepoSources(root, operations) {
    const issues = [];
    for (const op of operations) {
        if (op.op !== "create" && op.op !== "update")
            continue;
        issues.push(...await verifyRepoSourceList(root, op.entry.sources ?? []));
    }
    return issues;
}
export function stampRepoVerification(operations, now = new Date()) {
    return operations.map((op) => {
        if (op.op !== "create" && op.op !== "update")
            return op;
        return { ...op, entry: { ...op.entry, verifiedAt: now.toISOString(), verificationSources: [...(op.entry.sources ?? [])] } };
    });
}
export function describeMapOperations(operations, projectKey) {
    return operations.map((op) => {
        if (op.op === "create")
            return `create "${op.entry.title}" (${(op.entry.sources ?? []).length} source(s)) -> ${deriveEntryId(projectKey, op.entry.title)}`;
        if (op.op === "update")
            return `update ${op.target.id} "${op.entry.title}" (${(op.entry.sources ?? []).length} source(s))`;
        return op.op;
    });
}
export class MapSynthesizer {
    root;
    runtime;
    model;
    thinkingLevel;
    settings;
    loader;
    tools;
    constructor(root, runtime, model, thinkingLevel, settings, loader, tools) {
        this.root = root;
        this.runtime = runtime;
        this.model = model;
        this.thinkingLevel = thinkingLevel;
        this.settings = settings;
        this.loader = loader;
        this.tools = tools;
    }
    static async create(options) {
        const runtime = options.modelRuntime ?? await ModelRuntime.create({ modelsPath: options.modelsPath });
        const resolved = resolveCliModel({ cliModel: options.model, modelRuntime: runtime });
        if (resolved.error || !resolved.model)
            throw new Error(resolved.error ?? `Model not found: ${options.model}`);
        if (resolved.warning)
            throw new Error(resolved.warning);
        const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
        const env = { ...process.env, CHEATCODES_PROJECT_ROOT: options.projectRoot };
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
    async synthesize(context) {
        const startedAt = Date.now();
        let warning = "";
        let schemaRetries = 0;
        let usage;
        for (let attempt = 0; attempt < 2; attempt++) {
            const capture = {};
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
                if (modelFallbackMessage)
                    throw new Error(modelFallbackMessage);
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
            }
            catch (error) {
                warning = error.message;
            }
            finally {
                session.dispose();
            }
            schemaRetries = attempt + 1;
        }
        return { schemaInvalid: true, warning, schemaRetries, latencyMs: Date.now() - startedAt, usage };
    }
}
export async function runMap(options = {}) {
    const env = options.env ?? process.env;
    const root = path.resolve(options.root ?? env.CHEATCODES_PROJECT_ROOT ?? process.cwd());
    const global = await loadGlobalConfig(env);
    if (!global)
        throw new Error(`No global config at ${globalConfigPath(env)}`);
    const projectKey = await deriveProjectKey(root);
    const { entries, revision } = await loadCorpus(root, env);
    const existing = entries
        .filter((entry) => MAP_TITLES.includes(entry.title))
        .map((entry) => ({ id: entry.id, title: entry.title, summary: entry.summary, digest: entryDigest(entry) }));
    let modelsPath;
    try {
        modelsPath = await ensureModelsFile(env);
    }
    catch { /* no models registry; resolveCliModel falls back to the Pi default */ }
    const synthesizer = await MapSynthesizer.create({ projectRoot: root, model: global.model, modelsPath });
    const outcome = await synthesizer.synthesize({ entries, projectKey, existing });
    if (outcome.schemaInvalid || !outcome.operations) {
        return { status: "failed", warning: outcome.warning ?? "synthesis produced no valid map transaction", schemaRetries: outcome.schemaRetries };
    }
    const operations = stampRepoVerification(outcome.operations);
    if (operations.length === 0)
        return { status: "empty", warning: "no map entries warranted" };
    const stale = await verifyRepoSources(root, operations);
    if (stale.length > 0) {
        return { status: "failed", warning: `stale or invalid repo sources: ${stale.map((issue) => `${issue.source} (${issue.reason})`).join("; ")}` };
    }
    if (options.dryRun)
        return { status: "planned", planned: describeMapOperations(operations, projectKey) };
    const transaction = {
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
    const state = await loadCurationState(env, transaction.projectKey);
    await saveCurationState(env, {
        ...state,
        mapCursor: { inventoryDigest: await inventoryDigest(root), checkedAt: new Date().toISOString() },
    });
    return { status: "committed", committed, schemaRetries: outcome.schemaRetries };
}
// Free checks only: cited-source digests (Gap F) and the inventory digest
// (Gap A). Never synthesizes; callers decide whether stale is worth a model run.
export async function checkMapFreshness(root, env) {
    const { entries } = await loadCorpus(root, env);
    const mapEntries = entries.filter((entry) => MAP_TITLES.includes(entry.title));
    if (mapEntries.length === 0)
        return { state: "absent" };
    for (const entry of mapEntries) {
        const issues = await verifyRepoSourceList(root, entry.verificationSources ?? entry.sources ?? []);
        if (issues.length > 0)
            return { state: "stale", reason: "sources changed" };
    }
    const digest = await inventoryDigest(root);
    const projectKey = await deriveProjectKey(root);
    const state = await loadCurationState(env, projectKey);
    if (!state.mapCursor) {
        await saveCurationState(env, { ...state, mapCursor: { inventoryDigest: digest, checkedAt: new Date().toISOString() } });
        return { state: "fresh", seeded: true };
    }
    if (state.mapCursor.inventoryDigest !== digest)
        return { state: "stale", reason: "inventory changed" };
    await saveCurationState(env, { ...state, mapCursor: { ...state.mapCursor, checkedAt: new Date().toISOString() } });
    return { state: "fresh" };
}

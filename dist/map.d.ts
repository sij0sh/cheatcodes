import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type KnowledgeEntry } from "./concept.js";
import { type CommitResult } from "./maintain.js";
import { type KnowledgeOperation } from "./transaction.js";
export declare const MAP_PROMPT_VERSION = "map-3";
export declare const MAP_FAMILIES: readonly ["map:project-brief", "map:system", "map:capability"];
export declare const MAX_MAP_OPERATIONS = 16;
export declare const REPO_SOURCE_PATTERN: RegExp;
export declare const MAP_PROMPT = "You are the repository synthesizer for cheatcodes map.\nYou compress distributed repository truth into point entries grouped by three families.\nYou must inspect this repository yourself with the supplied tools; never rely on prior knowledge of the project.\nCall submit_map_transaction exactly once as your final action.\n\nTools (one mode per call):\n- search_knowledge {\"tree\": true}: bounded file inventory. Always start here.\n- search_knowledge {\"path\": \"<relative-path>\"}: read lines from one file and receive its sha256.\n- search_knowledge {\"query\": \"...\"}: search existing corpus entries.\n\nProcedure:\n1. Inventory the repository with search_knowledge {\"tree\": true}.\n2. Read package manifests, entry points, and configuration with search_knowledge {\"path\": \"...\"}.\n3. Correlate what you read across files.\n4. Submit one transaction: \"create\" operations for point entries that do not exist yet, \"update\" operations for entries in existingEntries (copy id and expectedDigest from that list).\n\nFamilies. Emit one entry per point; never one entry per family:\n- \"map:project-brief\": what the project observably is and does. Each entry states one point: the purpose, an actor, an input or output, or a major responsibility. Describe only what the code shows. Do not infer business motivation, target users, roadmap, or non-goals.\n- \"map:system\": how the pieces fit together. Each entry states one point: the runtime or stack, an entry point, a major component, an important flow, or a storage or integration fact.\n- \"map:capability\": what the system can actually do. Emit 3-8 entries. Include a capability only when knowing it changes a new engineer's mental model. Omit helpers, implementation details, and obvious CRUD variants.\n\nEntry shape:\n- title: a short stable phrase naming the point, unique across the submission and the corpus.\n- summary: one sentence stating the point.\n- body: the point as prose. No bullet lists and no Markdown headings.\n- tags: exactly the family tag, for example [\"map:capability\"]. Never empty and never more than one.\n\nAcceptance gates. Fail any gate and drop the entry:\n- crossFileValue: the entry must synthesize at least two distinct repository files you inspected this session. If one obvious file already states the claim, the gate fails.\n- singleSourceDuplicate: if one canonical file (for example README) already provides substantially the same explanation, the gate fails. Repo synthesis compresses distributed truth; it never mirrors documentation.\n- Summarize concepts, not inventory. Never list files, dependencies, or commands as facts in themselves.\n\nProvenance rules:\n- Every operation's entry carries sources: at least two \"repo:<relative-path>#sha256=<64-hex-digest>\" strings.\n- Cite only files you read with search_knowledge in this session, and copy the sha256 from that tool's output.\n- Never set kind or date. Never invent paths or digests. Keep summaries and bodies free of Markdown headings reserved for the corpus format.\n- Updates must keep the entry title; a point changes name by being recreated, never by being renamed.\n\nExisting map entries whose titles are absent from your submission are retired, so submit every point that should survive.\n\nSubmit shape:\n{\"operations\":[{\"op\":\"create\",\"entry\":{\"title\":\"Incremental session harvesting\",\"summary\":\"...\",\"body\":\"...\",\"tags\":[\"map:capability\"],\"sources\":[\"repo:src/harvest.ts#sha256=<digest>\",\"repo:src/jsonl.ts#sha256=<digest>\"]}},{\"op\":\"update\",\"target\":{\"id\":\"<existingEntryId>\",\"expectedDigest\":\"<existingEntryDigest>\"},\"entry\":{\"title\":\"Session scanning requires a platform-absolute cwd\",\"summary\":\"...\",\"body\":\"...\",\"tags\":[\"map:system\"],\"sources\":[\"repo:src/a.ts#sha256=<digest>\",\"repo:src/b.ts#sha256=<digest>\"]}}]}\n\nZero operations is a valid outcome when the repository is too small or too obvious to be worth caching. Never fill a quota.";
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
export declare function isMapEntry(entry: KnowledgeEntry): boolean;
export declare function validateMapOperations(value: unknown, context: MapContext): KnowledgeOperation[];
export interface RepoSourceIssue {
    source: string;
    reason: string;
}
export declare function verifyRepoSourceList(root: string, sources: readonly string[]): Promise<RepoSourceIssue[]>;
export declare function verifyRepoSources(root: string, operations: readonly KnowledgeOperation[]): Promise<RepoSourceIssue[]>;
export declare function stampRepoVerification(operations: readonly KnowledgeOperation[], now?: Date): KnowledgeOperation[];
/** The submitted set is authoritative: tagged entries left out are retired with stamped verification. */
export declare function planMapRetirements(existing: readonly KnowledgeEntry[], submitted: readonly KnowledgeOperation[], now?: Date): KnowledgeOperation[];
export declare function describeMapOperations(operations: readonly KnowledgeOperation[], projectKey: string): string[];
export interface MapSynthesisOutcome {
    operations?: KnowledgeOperation[];
    schemaInvalid: boolean;
    warning?: string;
    schemaRetries: number;
    latencyMs: number;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}
export interface MapSynthesizerOptions {
    projectRoot: string;
    model: string;
    modelRuntime?: ModelRuntime;
    modelsPath?: string;
}
export declare class MapSynthesizer {
    private readonly root;
    private readonly runtime;
    private readonly model;
    private readonly thinkingLevel;
    private readonly settings;
    private readonly loader;
    private readonly tools;
    private constructor();
    static create(options: MapSynthesizerOptions): Promise<MapSynthesizer>;
    synthesize(context: MapContext): Promise<MapSynthesisOutcome>;
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
export declare function runMap(options?: MapRunOptions): Promise<MapRunResult>;
export type MapFreshness = {
    state: "absent";
} | {
    state: "fresh";
    seeded?: boolean;
} | {
    state: "stale";
    reason: string;
};
export declare function checkMapFreshness(root: string, env: NodeJS.ProcessEnv): Promise<MapFreshness>;

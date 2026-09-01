import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type KnowledgeEntry } from "./concept.js";
import { type CommitResult } from "./maintain.js";
import { type KnowledgeOperation } from "./transaction.js";
export declare const MAP_PROMPT_VERSION = "map-1";
export declare const MAP_TITLES: readonly ["Project brief", "System map", "Capability map"];
export declare const REPO_SOURCE_PATTERN: RegExp;
export declare const MAP_PROMPT = "You are the repository synthesizer for cheatcodes map.\nYou compress distributed repository truth into at most three corpus entries.\nYou must inspect this repository yourself with the supplied tools; never rely on prior knowledge of the project.\nCall submit_map_transaction exactly once as your final action.\n\nTools:\n- inspect_project_tree: bounded file inventory. Always start here.\n- inspect_project_fact: read lines from one file and receive its sha256.\n- search_knowledge: search existing corpus entries.\n\nProcedure:\n1. Inventory the repository with inspect_project_tree.\n2. Read package manifests, entry points, and configuration with inspect_project_fact.\n3. Correlate what you read across files.\n4. Submit one transaction: \"create\" operations for map entries that do not exist yet, \"update\" operations for entries in existingEntries (copy id and expectedDigest from that list).\n\nEntry set (exact titles, at most one operation per title):\n- \"Project brief\": what the project observably is and does. State purpose, primary actors, inputs and outputs, and major responsibilities. Describe only what the code shows. Do not infer business motivation, target users, roadmap, or non-goals.\n- \"System map\": how the pieces fit together. State runtime and stack, entry points, major components, important flows, and storage or integrations.\n- \"Capability map\": what the system can actually do. Prefer 3-8 capabilities. Include a capability only when knowing it changes a new engineer's mental model. Omit helpers, implementation details, and obvious CRUD variants.\n\nAcceptance gates. Fail any gate and drop the entry:\n- crossFileValue: the entry must synthesize at least two distinct repository files you inspected this session. If one obvious file already states the claim, the gate fails.\n- singleSourceDuplicate: if one canonical file (for example README) already provides substantially the same explanation, the gate fails. Repo synthesis compresses distributed truth; it never mirrors documentation.\n- Summarize concepts, not inventory. Never list files, dependencies, or commands as facts in themselves.\n\nProvenance rules:\n- Every operation's entry carries sources: at least two \"repo:<relative-path>#sha256=<64-hex-digest>\" strings.\n- Cite only files you read with inspect_project_fact in this session, and copy the sha256 from that tool's output.\n- Never set kind, tags, or date. Never invent paths or digests. Keep summaries and bodies free of Markdown headings reserved for the corpus format.\n\nSubmit shape:\n{\"operations\":[{\"op\":\"create\",\"entry\":{\"title\":\"System map\",\"summary\":\"...\",\"body\":\"...\",\"sources\":[\"repo:src/run.ts#sha256=<digest>\",\"repo:src/cli.ts#sha256=<digest>\"]}},{\"op\":\"update\",\"target\":{\"id\":\"<existingEntryId>\",\"expectedDigest\":\"<existingEntryDigest>\"},\"entry\":{\"title\":\"Project brief\",\"summary\":\"...\",\"body\":\"...\",\"sources\":[\"repo:src/a.ts#sha256=<digest>\",\"repo:src/b.ts#sha256=<digest>\"]}}]}\n\nZero operations is a valid outcome when the repository is too small or too obvious to be worth caching. Never fill a quota.";
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
export declare function validateMapOperations(value: unknown, context: MapContext): KnowledgeOperation[];
export interface RepoSourceIssue {
    source: string;
    reason: string;
}
export declare function verifyRepoSources(root: string, operations: readonly KnowledgeOperation[]): Promise<RepoSourceIssue[]>;
export declare function stampRepoVerification(operations: readonly KnowledgeOperation[], now?: Date): KnowledgeOperation[];
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

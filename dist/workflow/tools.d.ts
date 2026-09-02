import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type KnowledgeEntry } from "../concept.js";
import { type KnowledgeTransaction } from "../transaction.js";
export declare const WORKFLOW_PROMPT_VERSION = "workflow-2";
export declare function loadCorpus(root: string, env: NodeJS.ProcessEnv): Promise<{
    entries: KnowledgeEntry[];
    revision: string;
}>;
export declare function searchKnowledgeTool(env?: NodeJS.ProcessEnv): ToolDefinition;
export type StagedTransaction = {
    ok: true;
    transaction: KnowledgeTransaction;
} | {
    ok: false;
    reason: "schema" | "validation" | "project-busy";
    detail?: string;
};
/** Shared staging tail (tool and host runner): parse, revalidate against the live corpus, park in curation state. */
export declare function writePendingTransaction(env: NodeJS.ProcessEnv, projectKey: string, entries: readonly KnowledgeEntry[], baseRevision: string, packetIds: string[], operations: unknown[]): Promise<StagedTransaction>;
export declare function createWorkflowTools(env?: NodeJS.ProcessEnv): ToolDefinition[];

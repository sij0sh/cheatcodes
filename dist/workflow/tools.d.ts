import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type KnowledgeEntry } from "../concept.js";
export declare const WORKFLOW_PROMPT_VERSION = "workflow-2";
export declare function loadCorpus(root: string, env: NodeJS.ProcessEnv): Promise<{
    entries: KnowledgeEntry[];
    revision: string;
}>;
export declare function searchKnowledgeTool(env?: NodeJS.ProcessEnv): ToolDefinition;
export declare function createWorkflowTools(env?: NodeJS.ProcessEnv): ToolDefinition[];

import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type KnowledgeEntry } from "../concept.js";
export { TREE_LIMITS } from "../inventory.js";
export declare const WORKFLOW_PROMPT_VERSION = "workflow-1";
export declare function loadCorpus(root: string, env: NodeJS.ProcessEnv): Promise<{
    entries: KnowledgeEntry[];
    revision: string;
}>;
export declare function loadEvidenceEpisodeTool(env?: NodeJS.ProcessEnv): ToolDefinition;
export declare function searchKnowledgeTool(env?: NodeJS.ProcessEnv): ToolDefinition;
export declare function inspectProjectFactTool(env?: NodeJS.ProcessEnv): ToolDefinition;
export declare function inspectProjectTreeTool(env?: NodeJS.ProcessEnv): ToolDefinition;
export declare function verifyCommandTool(env?: NodeJS.ProcessEnv): ToolDefinition;
export declare function stageKnowledgeTransactionTool(env?: NodeJS.ProcessEnv): ToolDefinition;
export declare function createWorkflowTools(env?: NodeJS.ProcessEnv): ToolDefinition[];

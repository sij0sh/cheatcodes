export declare const PRODUCER_VERSION: string;
export interface GlobalConfig {
    version: 2;
    model: string;
    inputs: string[];
    workerTimeoutMinutes: number;
    knowledgeFile?: string;
    contextPointer?: boolean;
    autorun?: boolean;
    autoMap?: boolean;
    projectAliases: Record<string, string[]>;
}
export declare function globalConfigPath(env?: NodeJS.ProcessEnv): string;
export declare function validateGlobalConfig(value: unknown, source?: string): GlobalConfig;
export declare function emptyGlobalConfig(model: string): GlobalConfig;
export declare function loadGlobalConfig(env?: NodeJS.ProcessEnv): Promise<GlobalConfig | undefined>;
export declare function saveGlobalConfig(config: GlobalConfig, env?: NodeJS.ProcessEnv): Promise<void>;
export declare function resolveGlobalInputs(config: GlobalConfig, env?: NodeJS.ProcessEnv): string[];
export declare function discoverDefaultInputs(env?: NodeJS.ProcessEnv): Promise<string[]>;
export declare function resolveProjectRoots(config: GlobalConfig, root: string, projectKey: string): string[];
export declare function deriveProjectKey(root: string): Promise<string>;
export declare const DEFAULT_KNOWLEDGE_FILE = ".agents/CHEATCODES.md";
export declare const LEGACY_DEFAULT_KNOWLEDGE_FILE = "CHEATCODES.md";
export declare function knowledgeFilePath(root: string, knowledgeFile?: string): string;
export interface KnowledgeOutput {
    knowledgeFile: string;
    contextFile?: string;
}
export declare function ensureKnowledgeOutput(root: string, knowledgeFile?: string, contextPointer?: boolean): Promise<KnowledgeOutput>;

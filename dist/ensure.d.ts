import { type MapFreshness } from "./map.js";
export declare const DEFAULT_ENSURE_TIMEOUT_SECONDS = 120;
export interface EnsureContext {
    env: NodeJS.ProcessEnv;
    root: string;
    projectKey: string;
    deadline: number;
}
export interface CurateStage {
    outcome: "success" | "timeout" | "failed" | "coalesced" | "skipped";
    reason?: string;
    changedFiles?: number;
    entriesWritten?: number;
}
export interface WorkflowStage {
    outcome: "completed" | "skipped" | "parked" | "none";
    warning?: string;
    warnings?: string[];
}
export type EnsureMapStatus = "fresh" | "absent" | "synthesized" | "stale (sources changed)" | "stale (inventory changed)" | "failed";
export type EnsureStatus = "refreshed" | "up-to-date" | "timeout" | "locked" | "error";
export interface EnsureResult {
    status: EnsureStatus;
    curated?: {
        changedFiles: number;
        entriesWritten: number;
    };
    workflow?: WorkflowStage["outcome"];
    map?: EnsureMapStatus;
    warning?: string;
    warnings: string[];
}
export interface EnsureStages {
    curate?: (context: EnsureContext) => Promise<CurateStage>;
    syncWorkflow?: (context: EnsureContext) => Promise<WorkflowStage>;
    checkMap?: (context: EnsureContext) => Promise<MapFreshness>;
    synthesizeMap?: (context: EnsureContext) => Promise<{
        ok: boolean;
        warning?: string;
    }>;
}
export interface EnsureOptions {
    root?: string;
    timeoutSeconds?: number;
    synthesizeMap?: boolean;
    env?: NodeJS.ProcessEnv;
    stages?: EnsureStages;
}
export declare function resolveEnsureTimeoutSeconds(env: NodeJS.ProcessEnv, override?: number): number;
export declare function runEnsure(options?: EnsureOptions): Promise<EnsureResult>;

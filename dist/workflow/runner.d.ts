import { type CommitResult } from "../maintain.js";
import { type EpisodeManifest } from "./manifests.js";
export interface TerminalReport {
    status: "completed" | "parked" | "unknown";
    sessionFile?: string;
}
export interface WorkflowRunResult {
    started: boolean;
    manifestId?: string;
    terminal?: TerminalReport;
    applied?: CommitResult;
    warning?: string;
    warnings: string[];
}
export type PiLauncher = (options: {
    root: string;
    target: string;
}) => Promise<{
    exitCode: number;
}>;
/**
 * The engine stamps every snapshot into its session JSONL. A run counts as
 * terminal success only when the newest choreograph snapshot reports
 * `completed`; parked or missing reports never apply staged work.
 */
export declare function findTerminalReport(env: NodeJS.ProcessEnv, root: string, sinceMs: number, manifestId?: string): Promise<TerminalReport>;
export declare function runWorkflowCurator(options?: {
    root?: string;
    env?: NodeJS.ProcessEnv;
    launcher?: PiLauncher;
}): Promise<WorkflowRunResult>;
export declare function loadManifestForReplay(root: string, manifestId: string): Promise<EpisodeManifest | undefined>;

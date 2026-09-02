import { type CommitResult } from "../maintain.js";
import { type EpisodeManifest } from "./manifests.js";
export interface TerminalReport {
    status: "completed" | "parked" | "unknown";
    sessionFile?: string;
    /** Checkpoint data of the terminal `challenge` position; the workflow is read-only, so the host stages it. */
    challenged?: unknown;
}
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
 * The workflow agent is read-only, so the host performs the staging the old
 * tool call performed. Digests are injected from the live corpus because a
 * read-only agent cannot compute them; the baseRevision check keeps the
 * optimistic-concurrency guard against corpus changes since the manifest.
 */
export declare function stageChallengedTransaction(options: {
    env: NodeJS.ProcessEnv;
    root: string;
    manifest: EpisodeManifest;
    challenged: unknown;
}): Promise<{
    staged: boolean;
    warning?: string;
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

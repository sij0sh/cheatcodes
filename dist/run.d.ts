import { type Curator } from "./curate.js";
import { type CuratorMode } from "./metrics.js";
import { type Qualifier } from "./qualify.js";
import { type ScanWarning } from "./scan.js";
import { type FileLock, type RunRecord } from "./state.js";
export interface LauncherHints {
    sessionFile?: string;
    previousSessionFile?: string;
    model?: string;
    thinking?: boolean;
}
export declare function readLauncherHints(env?: NodeJS.ProcessEnv): LauncherHints;
export declare function hintModel(hints: LauncherHints): string | undefined;
export declare function hintInputs(hints: LauncherHints): string[];
export interface RunOptions {
    root?: string;
    cwd?: string;
    curator?: Curator;
    curatorFactory?: () => Promise<Curator>;
    qualifier?: Qualifier;
    qualifierFactory?: () => Promise<Qualifier>;
    now?: () => Date;
    onWarning?: (message: string) => void;
    shouldStop?: () => boolean;
    extraInputs?: string[];
    env?: NodeJS.ProcessEnv;
    lock?: FileLock;
}
export interface RunResult {
    root: string;
    projectKey: string;
    changedFiles: number;
    curatorCalls: number;
    packets: number;
    entriesWritten: number;
    prunedCursors: number;
    unresolvedFiles: number;
    warnings: string[];
    staleLockRecovered: boolean;
    deadlineExceeded: boolean;
    mode: CuratorMode;
}
export declare function resolveCuratorMode(env: NodeJS.ProcessEnv): {
    mode: CuratorMode;
    warning?: string;
};
export declare function runProject(options?: RunOptions): Promise<RunResult>;
export interface ProjectStatus {
    root: string;
    projectKey: string;
    inputs: string[];
    missingInputs: string[];
    discoveredFiles: number;
    entries: number;
    skipped: ScanWarning[];
    knowledgeFile: string;
    lastRun?: RunRecord;
}
export declare function projectStatus(root?: string, env?: NodeJS.ProcessEnv): Promise<ProjectStatus>;
export type WorkerOutcome = "success" | "failed" | "coalesced" | "skipped" | "timeout";
export interface WorkerResult {
    outcome: WorkerOutcome;
    invocationId: string;
    root?: string;
    projectKey?: string;
    reason?: string;
    warnings: string[];
    run?: RunResult;
}
export declare function runWorker(options?: RunOptions): Promise<WorkerResult>;

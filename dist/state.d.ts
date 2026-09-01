export interface FileCursor {
    sessionId: string;
    committedOffset: number;
    observedSize: number;
    mtimeMs: number;
    prefixSha256: string;
}
export type RunOutcome = "success" | "failed" | "coalesced" | "timeout";
export interface RunRecord {
    version: 1;
    invocationId: string;
    pid: number;
    startedAt: string;
    finishedAt: string;
    outcome: RunOutcome;
    reason?: string;
    changedFiles?: number;
    curatorCalls?: number;
    entriesWritten?: number;
    warnings?: string[];
}
export interface ProjectState {
    files: Record<string, FileCursor>;
    lastRun?: RunRecord;
}
export interface GlobalState {
    version: 1;
    projects: Record<string, ProjectState>;
}
export declare const EMPTY_PROJECT_STATE: ProjectState;
export declare const EMPTY_GLOBAL_STATE: GlobalState;
export declare function globalStatePath(env?: NodeJS.ProcessEnv): string;
export declare function sha256(value: string): string;
export declare function atomicWrite(file: string, bytes: Uint8Array | string): Promise<void>;
export declare function orderState(state: GlobalState): GlobalState;
export declare function loadGlobalState(env?: NodeJS.ProcessEnv): Promise<GlobalState>;
export interface FileLock {
    path: string;
    coalesced: boolean;
    staleRecovered: boolean;
    release(): Promise<void>;
}
export declare function stateLockPath(env?: NodeJS.ProcessEnv): string;
export declare function projectLockPath(env: NodeJS.ProcessEnv | undefined, projectKey: string): string;
export declare function acquireStateLock(env?: NodeJS.ProcessEnv): Promise<FileLock>;
export declare function acquireProjectLock(env: NodeJS.ProcessEnv, projectKey: string, options?: {
    coalesce?: boolean;
    waitMs?: number;
}): Promise<FileLock>;
export declare function updateProjectState(env: NodeJS.ProcessEnv, projectKey: string, mutate: (project: ProjectState) => ProjectState): Promise<GlobalState>;

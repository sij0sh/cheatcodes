import { clusterCandidates } from "./reconcile.js";
import { type KnowledgeOperation, type KnowledgeTransaction } from "./transaction.js";
import { type FileLock } from "./state.js";
export declare const MAINTENANCE_PROMPT_VERSION = "maintain-1";
export declare const MAINTENANCE_MODEL_ID = "host";
export interface MaintenancePlan {
    projectKey: string;
    baseRevision: string;
    clusters: ReturnType<typeof clusterCandidates>;
    operations: KnowledgeOperation[];
    reviewedIds: string[];
    missingVerification: {
        id: string;
        reason: string;
    }[];
    resultingCount: number;
}
export declare function planMaintenance(env: NodeJS.ProcessEnv, root: string, global: {
    knowledgeFile?: string;
}): Promise<MaintenancePlan>;
export interface MaintenanceSchedule {
    due: boolean;
    reasons: string[];
}
export declare function maintenanceSchedule(env: NodeJS.ProcessEnv, root: string): Promise<MaintenanceSchedule>;
export interface CommitResult {
    transactionId: string;
    baseRevision: string;
    resultRevision: string;
    entryCountBefore: number;
    entryCountAfter: number;
    tombstones: number;
    reviews: number;
}
export declare function maintenanceTransactionId(baseRevision: string, operations: readonly KnowledgeOperation[]): string;
export declare function commitKnowledgeTransaction(env: NodeJS.ProcessEnv, root: string, transaction: KnowledgeTransaction, lock?: FileLock): Promise<CommitResult>;
export type MaintenanceMode = "dry-run" | "apply" | "resume";
export interface MaintainOutcome {
    plan?: MaintenancePlan;
    committed?: CommitResult;
    warning?: string;
}
export declare function maintainProject(options?: {
    env?: NodeJS.ProcessEnv;
    root?: string;
    mode?: MaintenanceMode;
    lock?: FileLock;
}): Promise<MaintainOutcome>;

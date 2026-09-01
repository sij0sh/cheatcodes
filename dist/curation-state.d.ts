import type { KnowledgeTransaction } from "./transaction.js";
export interface PacketOutcome {
    packetId: string;
    at: string;
    status: "applied" | "rejected" | "needs-review" | "failed";
    verdict?: string;
    reason?: string;
    transactionId?: string;
}
export interface Tombstone {
    id: string;
    title: string;
    op: "delete" | "merge";
    reason: string;
    digest: string;
    mergedInto?: string;
    transactionId: string;
    removedAt: string;
}
export interface ReviewRecord {
    id: string;
    targets: string[];
    conflict: string;
    nextAction: string;
    transactionId: string;
    createdAt: string;
    status: "open" | "resolved";
    resolution?: string;
}
export interface TransactionReceipt {
    transactionId: string;
    at: string;
    baseRevision: string;
    resultRevision: string;
    applied: string[];
    entryCountBefore: number;
    entryCountAfter: number;
}
export interface MaintenanceCursor {
    at: string;
    lastTransactionId?: string;
    pendingTransaction?: KnowledgeTransaction;
}
export interface MapCursor {
    inventoryDigest: string;
    checkedAt: string;
}
export interface CurationState {
    version: 1;
    projectKey: string;
    revision: string;
    packetOutcomes: Record<string, PacketOutcome>;
    tombstones: Tombstone[];
    reviews: ReviewRecord[];
    transactions: TransactionReceipt[];
    maintenanceCursor?: MaintenanceCursor;
    mapCursor?: MapCursor;
}
export declare const CURATION_STATE_LIMITS: {
    readonly receipts: 50;
    readonly packetOutcomes: 500;
    readonly resolvedReviews: 100;
    readonly tombstones: 1000;
};
export declare function emptyCurationState(projectKey: string, revision?: string): CurationState;
export declare function isCurationState(value: unknown, projectKey?: string): value is CurationState;
export declare function curationStatePath(env: NodeJS.ProcessEnv, projectKey: string): string;
export declare function boundedCurationState(state: CurationState): CurationState;
/**
 * Fails closed: only a missing file means a fresh project. Any other read or
 * validation failure throws, because a silent empty state would let the next
 * commit overwrite tombstones, reviews, and receipts.
 */
export declare function loadCurationState(env: NodeJS.ProcessEnv, projectKey: string): Promise<CurationState>;
export declare function saveCurationState(env: NodeJS.ProcessEnv, state: CurationState): Promise<void>;

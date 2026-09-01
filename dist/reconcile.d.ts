import { type KnowledgeEntry } from "./concept.js";
import type { KnowledgeOperation } from "./transaction.js";
export interface CandidateCluster {
    id: string;
    kind: "duplicate" | "contradiction";
    entryIds: string[];
    reasons: string[];
}
export declare function clusterCandidates(entries: readonly KnowledgeEntry[]): CandidateCluster[];
export declare function digestFor(entries: readonly KnowledgeEntry[], id: string): string | undefined;
export declare function pickSurvivor(entries: readonly KnowledgeEntry[], ids: readonly string[]): KnowledgeEntry;
export declare function proposeOperations(clusters: readonly CandidateCluster[], entries: readonly KnowledgeEntry[]): KnowledgeOperation[];

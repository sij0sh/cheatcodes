import type { NormalizedRecord, ParsedSession, ToolReceipt } from "./jsonl.js";
export declare const PACKET_CHARACTER_CAP = 12000;
export declare const SHORTLIST_LIMIT = 8;
export type SignalKind = "resolved-failure" | "correction" | "workflow-checkpoint" | "decision" | "procedure";
export type EpisodeClosure = "assistant-settled" | "workflow-terminal" | "user-superseded" | "incomplete";
export interface Episode {
    id: string;
    sessionId: string;
    closure: EpisodeClosure;
    eligible: boolean;
    branchLeafId?: string;
    records: NormalizedRecord[];
    recordIds: string[];
    hasNewRecord: boolean;
    signals: SignalKind[];
    signalReasons: string[];
}
export interface EvidenceItem {
    id: string;
    kind: "message" | "tool" | "checkpoint";
    excerpt: string;
    recordIds: string[];
    path?: string;
}
export interface EntrySummary {
    id: string;
    title: string;
    summary: string;
    tags?: string[];
    body?: string;
}
export interface ShortlistItem {
    id: string;
    title: string;
    summary: string;
    score: number;
}
export interface UpdateCandidate extends ShortlistItem {
    body: string;
}
export interface HarvestPacket {
    id: string;
    projectKey: string;
    sessionId: string;
    episodeId: string;
    recordIds: string[];
    signals: SignalKind[];
    closure: EpisodeClosure;
    branchLeafId?: string;
    signalReasons: string[];
    omittedEvidenceCount: number;
    packetFitReason: string;
    userIntent: string;
    finalAssistantSummary: string;
    evidence: EvidenceItem[];
    shortlist: ShortlistItem[];
    updateCandidate?: UpdateCandidate;
}
export interface HarvestOptions {
    projectKey: string;
    entries?: readonly EntrySummary[];
    packetCharacterCap?: number;
    shortlistLimit?: number;
}
export declare function isCorrection(text: string | undefined): boolean;
export declare function segmentBranch(branch: readonly NormalizedRecord[], sessionId?: string): Episode[];
export declare function segmentSession(session: Pick<ParsedSession, "sessionId" | "branches">): Episode[];
export declare function successfulMutation(receipt: ToolReceipt | undefined): boolean;
export declare const NOMINATING_SIGNALS: readonly SignalKind[];
export declare function detectHighSignal(records: readonly NormalizedRecord[]): SignalKind[];
export declare function explainSignals(records: readonly NormalizedRecord[]): string[];
export declare function shortlistEntries(episode: Episode, entries: readonly EntrySummary[], limit?: number): {
    shortlist: ShortlistItem[];
    updateCandidate?: UpdateCandidate;
};
export declare function createPacket(episode: Episode, options: HarvestOptions): HarvestPacket | undefined;

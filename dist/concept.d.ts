export type EntryKind = "gotcha" | "decision" | "procedure" | "invariant";
export interface KnowledgeEntry {
    id: string;
    title: string;
    summary: string;
    body: string;
    date?: string;
    tags?: string[];
    sources?: string[];
    kind?: EntryKind;
    verifiedAt?: string;
    verificationSources?: string[];
}
export interface CuratedEntryInput {
    action: "create" | "update";
    targetEntryId?: string;
    title: string;
    summary: string;
    body: string;
    date?: string;
    tags?: string[];
    sources?: string[];
}
export declare class KnowledgeValidationError extends Error {
    readonly issues: string[];
    constructor(issues: string[]);
}
export declare const RESERVED_TEXT: string[];
export declare function validateEntry(value: unknown): KnowledgeEntry;
export declare function normalizeTitleKey(title: string): string;
export declare function renderKnowledgeMarkdown(entries: readonly KnowledgeEntry[]): string;
/**
 * The knowledge file is human-editable Markdown (README), so text outside entry
 * markers must survive automated rewrites. Regions are captured and re-emitted
 * byte-for-byte at their ordinal positions; adjacency is best-effort when the
 * entry set changes. The newline after a close marker belongs to the gap, not
 * the block.
 */
export interface KnowledgeRegions {
    preamble: string;
    gaps: string[];
    trailing: string;
}
export interface KnowledgeDocument {
    entries: KnowledgeEntry[];
    regions: KnowledgeRegions;
}
export declare function renderKnowledgeDocument(document: {
    entries: readonly KnowledgeEntry[];
    regions?: KnowledgeRegions;
}): string;
export declare function parseKnowledgeMarkdown(markdown: string): KnowledgeEntry[];
export declare function parseKnowledgeDocument(markdown: string): KnowledgeDocument;
export declare function removeEntriesFromSessions(entries: readonly KnowledgeEntry[], sessionIds: readonly string[]): {
    entries: KnowledgeEntry[];
    removed: number;
};
export declare function deriveEntryId(projectKey: string, title: string): string;
export declare function applyCuratedEntry(entries: readonly KnowledgeEntry[], input: CuratedEntryInput, projectKey: string): {
    entries: KnowledgeEntry[];
    changed: boolean;
    id: string;
};
export declare function entryDigest(entry: KnowledgeEntry): string;
export declare function corpusRevision(entries: readonly KnowledgeEntry[]): string;

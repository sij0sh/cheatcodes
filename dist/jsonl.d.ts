export declare const RECEIPT_EXCERPT_LIMIT = 1200;
export interface ByteRange {
    start: number;
    end: number;
}
export interface JsonlWarning {
    file?: string;
    range: ByteRange;
    message: string;
}
export interface SessionHeader {
    type: "session";
    version: number;
    id: string;
    timestamp?: string;
    cwd?: string;
    origin?: SessionOrigin;
}
export type NormalizedRecordKind = "user" | "assistant" | "tool" | "bash" | "workflow";
export type ValidationState = "passed" | "failed" | "ambiguous" | "none";
export declare const WORKER_ORIGIN = "cheatcodes-worker";
export type SessionOrigin = "user-session" | "cheatcodes-worker";
export declare function isWorkerEntry(value: unknown): boolean;
export interface ToolReceipt {
    toolCallId?: string;
    tool: string;
    path?: string;
    command?: string;
    contentSha256?: string;
    excerpt?: string;
    exitCode?: number;
    isError?: boolean;
    mutation: boolean;
    validation: ValidationState;
    accepted?: boolean;
    node?: string;
    summary?: string;
    decisions?: unknown;
    evidence?: unknown;
}
export interface NormalizedRecord {
    id: string;
    parentId: string | null;
    sourceParentId: string | null;
    sessionId: string;
    timestamp?: string;
    range: ByteRange;
    byteHash: string;
    kind: NormalizedRecordKind;
    role?: string;
    text?: string;
    receipt?: ToolReceipt;
    turnId?: string;
    toolCallId?: string;
    assistantStopReason?: string;
    branchLeafId?: string;
    origin?: SessionOrigin;
    isNew: boolean;
}
export interface ParseJsonlOptions {
    file?: string;
    previousCommittedOffset?: number;
    rewritten?: boolean;
    projectId?: string;
    projectRoots?: string[];
    cwd?: string;
}
export interface ParsedSession {
    header: SessionHeader;
    version: number;
    sessionId: string;
    records: NormalizedRecord[];
    branches: NormalizedRecord[][];
    origin: SessionOrigin;
    warnings: JsonlWarning[];
    completeOffset: number;
    completeSha256: string;
    previousPrefixSha256: string;
}
export declare function sessionHeaderFromRecord(value: unknown): SessionHeader | undefined;
export declare function textContent(value: unknown): string;
export declare function redactSecrets(input: string): string;
export declare function normalizeRepositoryPath(candidate: string, projectId: string, projectRoots: readonly string[], cwd?: string): string | undefined;
export declare function buildBranches(records: readonly NormalizedRecord[]): NormalizedRecord[][];
export declare function parseJsonlBytes(bytes: Buffer | Uint8Array, options?: ParseJsonlOptions): ParsedSession;
export declare function parseJsonlFile(file: string, options?: Omit<ParseJsonlOptions, "file">): Promise<ParsedSession>;

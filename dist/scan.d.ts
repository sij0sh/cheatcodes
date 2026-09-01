import type { FileCursor } from "./state.js";
export interface SessionCandidate {
    file: string;
    size: number;
    mtimeMs: number;
}
export interface ScanWarning {
    file: string;
    message: string;
}
export interface ScanResult {
    changed: SessionCandidate[];
    unchanged: string[];
    skipped: ScanWarning[];
    missing: string[];
    foreignSessionIds: string[];
}
export declare function scanInputs(inputs: string[], projectRoots: string[], files: Record<string, FileCursor>): Promise<ScanResult>;

import type { QualificationVerdict } from "./qualify.js";
export type CuratorMode = "legacy" | "typed" | "shadow";
export type CurationAgreement = "agree" | "disagree" | "legacy-error";
export interface CurationMetrics {
    version: 1;
    at: string;
    mode: CuratorMode;
    projectKey: string;
    sessionId: string;
    packetId: string;
    model: string;
    promptVersion: string;
    verdict?: QualificationVerdict;
    gateFailures: string[];
    rejectionReasons: string[];
    schemaRetries: number;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    legacyWouldWrite?: boolean;
    agreement?: CurationAgreement;
    wrote: boolean;
}
export declare function curationMetricsPath(env?: NodeJS.ProcessEnv): string;
export declare function recordCurationMetrics(record: CurationMetrics, env?: NodeJS.ProcessEnv): Promise<boolean>;

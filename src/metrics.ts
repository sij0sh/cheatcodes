import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { QualificationVerdict } from "./qualify.js";
import { globalStatePath } from "./state.js";

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

export function curationMetricsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(globalStatePath(env)), "curation-metrics.jsonl");
}

export async function recordCurationMetrics(record: CurationMetrics, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    const file = curationMetricsPath(env);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`);
    return true;
  } catch {
    return false;
  }
}

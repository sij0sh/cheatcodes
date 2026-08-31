import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, globalStatePath } from "./state.js";
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

export interface CurationState {
  version: 1;
  projectKey: string;
  revision: string;
  packetOutcomes: Record<string, PacketOutcome>;
  tombstones: Tombstone[];
  reviews: ReviewRecord[];
  transactions: TransactionReceipt[];
  maintenanceCursor?: MaintenanceCursor;
}

export const CURATION_STATE_LIMITS = {
  receipts: 50,
  packetOutcomes: 500,
  resolvedReviews: 100,
  tombstones: 1000,
} as const;

export function emptyCurationState(projectKey: string, revision = ""): CurationState {
  return { version: 1, projectKey, revision, packetOutcomes: {}, tombstones: [], reviews: [], transactions: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCurationState(value: unknown, projectKey?: string): value is CurationState {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.projectKey !== "string") return false;
  if (projectKey !== undefined && value.projectKey !== projectKey) return false;
  if (!isRecord(value.packetOutcomes) || !Array.isArray(value.tombstones) || !Array.isArray(value.reviews) || !Array.isArray(value.transactions)) return false;
  if (value.maintenanceCursor !== undefined && !isRecord(value.maintenanceCursor)) return false;
  return true;
}

export function curationStatePath(env: NodeJS.ProcessEnv, projectKey: string): string {
  const safe = projectKey.replace(/[^A-Za-z0-9._-]/g, "-");
  return path.join(path.dirname(globalStatePath(env)), "curation", `${safe}.json`);
}

export function boundedCurationState(state: CurationState): CurationState {
  const packetEntries = Object.entries(state.packetOutcomes);
  const bounded: CurationState = {
    ...state,
    transactions: state.transactions.slice(-CURATION_STATE_LIMITS.receipts),
    tombstones: state.tombstones.slice(-CURATION_STATE_LIMITS.tombstones),
    reviews: (() => {
      const open = state.reviews.filter((review) => review.status === "open");
      const resolved = state.reviews.filter((review) => review.status !== "open").slice(-CURATION_STATE_LIMITS.resolvedReviews);
      return [...open, ...resolved];
    })(),
    packetOutcomes: Object.fromEntries(packetEntries.slice(-CURATION_STATE_LIMITS.packetOutcomes)),
  };
  return bounded;
}

export async function loadCurationState(env: NodeJS.ProcessEnv, projectKey: string): Promise<CurationState> {
  try {
    const raw = JSON.parse(await readFile(curationStatePath(env, projectKey), "utf8"));
    if (!isCurationState(raw, projectKey)) return emptyCurationState(projectKey);
    return raw;
  } catch {
    return emptyCurationState(projectKey);
  }
}

export async function saveCurationState(env: NodeJS.ProcessEnv, state: CurationState): Promise<void> {
  const file = curationStatePath(env, state.projectKey);
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, JSON.stringify(boundedCurationState(state), null, 2));
}

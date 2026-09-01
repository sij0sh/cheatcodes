import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  corpusRevision,
  entryDigest,
  entryOrder,
  parseKnowledgeDocument,
  parseKnowledgeMarkdown,
  renderKnowledgeDocument,
  type KnowledgeEntry,
} from "./concept.js";
import { deriveProjectKey, globalConfigPath, knowledgeFilePath, loadGlobalConfig } from "./config.js";
import { loadCurationState, saveCurationState, type CurationState, type TransactionReceipt } from "./curation-state.js";
import { clusterCandidates, proposeOperations } from "./reconcile.js";
import { applyKnowledgeTransaction, validateTransactionOperations, type KnowledgeOperation, type KnowledgeTransaction } from "./transaction.js";
import { acquireProjectLock, atomicWrite, type FileLock } from "./state.js";

export const MAINTENANCE_PROMPT_VERSION = "maintain-1";
export const MAINTENANCE_MODEL_ID = "host";

export interface MaintenancePlan {
  projectKey: string;
  baseRevision: string;
  clusters: ReturnType<typeof clusterCandidates>;
  operations: KnowledgeOperation[];
  reviewedIds: string[];
  missingVerification: { id: string; reason: string }[];
  resultingCount: number;
}

export async function planMaintenance(env: NodeJS.ProcessEnv, root: string, global: { knowledgeFile?: string }): Promise<MaintenancePlan> {
  const projectKey = await deriveProjectKey(root);
  const entries = parseKnowledgeMarkdown(await readFile(knowledgeFilePath(root, global.knowledgeFile), "utf8"));
  const clusters = clusterCandidates(entries);
  const operations = proposeOperations(clusters, entries);
  const verified = entries.filter((entry) => entry.verifiedAt !== undefined).map((entry) => entry.id);
  const survivors = operations.filter((op) => op.op === "merge").map((op) => op.survivorId);
  const operationsWithCoverage = await withCoverageOps(env, projectKey, entries, operations, verified, survivors);
  const missingVerification = clusters
    .flatMap((cluster) => cluster.entryIds)
    .filter((id) => !verified.includes(id))
    .filter((id, index, all) => all.indexOf(id) === index)
    .map((id) => ({ id, reason: "entry has no current verification" }));
  let resultingCount = entries.length;
  for (const op of operations) {
    if (op.op === "create") resultingCount++;
    if (op.op === "delete") resultingCount--;
    if (op.op === "merge") resultingCount -= op.targets.length - 1;
  }
  return { projectKey, baseRevision: corpusRevision(entries), clusters, operations: operationsWithCoverage, reviewedIds: [...new Set([...verified, ...survivors])].sort(), missingVerification, resultingCount };
}

const MAINTENANCE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface MaintenanceSchedule {
  due: boolean;
  reasons: string[];
}

/** Coverage cursor: entries that were never reviewed are nominated, so isolated stale entries cannot hide. */
async function withCoverageOps(
  env: NodeJS.ProcessEnv,
  projectKey: string,
  entries: readonly KnowledgeEntry[],
  operations: readonly KnowledgeOperation[],
  verified: readonly string[],
  survivors: readonly string[],
): Promise<KnowledgeOperation[]> {
  const targeted = new Set<string>();
  for (const op of operations) {
    if (op.op === "needs-review") op.targets.forEach((id) => targeted.add(id));
    else if (op.op === "merge") op.targets.forEach((target) => targeted.add(target.id));
    else if (op.op === "create") continue; // new entries are reviewed at the next cycle
    else if (op.op === "delete" || op.op === "update" || op.op === "keep") targeted.add(op.target.id);
  }
  const state = await loadCurationState(env, projectKey);
  const openReviewTargets = state.reviews.filter((review) => review.status === "open").flatMap((review) => review.targets);
  const reviewed = new Set([...verified, ...survivors, ...targeted, ...openReviewTargets]);
  const coverageOps: KnowledgeOperation[] = entries
    .filter((entry) => !reviewed.has(entry.id))
    .map((entry) => ({
      op: "needs-review" as const,
      targets: [entry.id],
      conflict: "entry has never been reviewed",
      nextAction: "verify current truth against the project or remove the entry",
    }));
  return [...operations, ...coverageOps];
}

export async function maintenanceSchedule(env: NodeJS.ProcessEnv, root: string): Promise<MaintenanceSchedule> {
  const projectKey = await deriveProjectKey(root);
  const state = await loadCurationState(env, projectKey);
  const cursor = state.maintenanceCursor;
  if (!cursor) return { due: true, reasons: ["no maintenance has run yet"] };
  const age = Date.now() - Date.parse(cursor.at);
  if (!Number.isFinite(age) || age >= MAINTENANCE_INTERVAL_MS) {
    return { due: true, reasons: [`last maintenance ${cursor.at} is older than the maintenance interval`] };
  }
  return { due: false, reasons: [] };
}

export interface CommitResult {
  transactionId: string;
  baseRevision: string;
  resultRevision: string;
  entryCountBefore: number;
  entryCountAfter: number;
  tombstones: number;
  reviews: number;
}

export function maintenanceTransactionId(baseRevision: string, operations: readonly KnowledgeOperation[]): string {
  const digest = createHash("sha256").update(JSON.stringify({ baseRevision, operations })).digest("hex");
  return `mt-${digest.slice(0, 16)}`;
}

export async function commitKnowledgeTransaction(
  env: NodeJS.ProcessEnv,
  root: string,
  transaction: KnowledgeTransaction,
  lock?: FileLock,
): Promise<CommitResult> {
  const owned = lock === undefined;
  const projectLock = lock ?? await acquireProjectLock(env, transaction.projectKey);
  try {
    const global = await loadGlobalConfig(env);
    if (!global) throw new Error(`No global config at ${globalConfigPath(env)}`);
    const file = knowledgeFilePath(root, global.knowledgeFile);
    // Steps 2-3: read, parse, compute the current revision.
    const document = parseKnowledgeDocument(await readFile(file, "utf8"));
    const entries: KnowledgeEntry[] = document.entries;
    const revision = corpusRevision(entries);
    // Step 4: reject a stale base revision.
    if (transaction.baseRevision !== revision) {
      throw new Error(`stale transaction ${transaction.transactionId}: base revision ${transaction.baseRevision.slice(0, 12)} does not match corpus revision ${revision.slice(0, 12)}`);
    }
    // Steps 5-7: validate operations, apply in memory, validate resulting entries.
    const applied = applyKnowledgeTransaction(entries, transaction, transaction.projectKey);
    // The rendered document orders entries canonically; creates may interleave,
    // so the round-trip comparison must use that same order.
    const ordered = [...applied.entries].sort((a, b) => (entryOrder(a) < entryOrder(b) ? -1 : entryOrder(a) > entryOrder(b) ? 1 : 0));
    // Steps 8-9: render and re-parse; the round-trip must reproduce the entry set.
    const rendered = renderKnowledgeDocument({ entries: ordered, regions: document.regions });
    const reparsed = parseKnowledgeMarkdown(rendered);
    if (reparsed.length !== ordered.length || reparsed.some((entry, index) => entryDigest(entry) !== entryDigest(ordered[index]!))) {
      throw new Error(`transaction ${transaction.transactionId}: rendered Markdown does not round-trip`);
    }
    // Stage the transaction before the corpus write so an interrupted commit can resume.
    const staged = await loadCurationState(env, transaction.projectKey);
    await saveCurationState(env, { ...staged, maintenanceCursor: { at: new Date().toISOString(), pendingTransaction: transaction } });
    // Step 10: atomically replace the corpus once.
    await atomicWrite(file, rendered);
    // Step 11: atomically update curation state (receipt, tombstones, reviews, outcomes).
    const receipt: TransactionReceipt = {
      transactionId: transaction.transactionId,
      at: new Date().toISOString(),
      baseRevision: transaction.baseRevision,
      resultRevision: applied.resultRevision,
      applied: transaction.operations.map((op, index) => `${index}:${op.op}`),
      entryCountBefore: entries.length,
      entryCountAfter: applied.entries.length,
    };
    const packetOutcomes = { ...staged.packetOutcomes };
    for (const packetId of transaction.packetIds) {
      packetOutcomes[packetId] = { packetId, at: receipt.at, status: "applied", transactionId: transaction.transactionId };
    }
    const finalState: CurationState = {
      ...staged,
      revision: applied.resultRevision,
      packetOutcomes,
      tombstones: [...staged.tombstones, ...applied.tombstones],
      reviews: [...staged.reviews, ...applied.reviews],
      transactions: [...staged.transactions, receipt],
      maintenanceCursor: { at: receipt.at, lastTransactionId: transaction.transactionId },
    };
    await saveCurationState(env, finalState);
    return {
      transactionId: transaction.transactionId,
      baseRevision: transaction.baseRevision,
      resultRevision: applied.resultRevision,
      entryCountBefore: entries.length,
      entryCountAfter: applied.entries.length,
      tombstones: applied.tombstones.length,
      reviews: applied.reviews.length,
    };
  } finally {
    if (owned) await projectLock.release();
  }
}

export type MaintenanceMode = "dry-run" | "apply" | "resume";

export interface MaintainOutcome {
  plan?: MaintenancePlan;
  committed?: CommitResult;
  warning?: string;
}

export async function maintainProject(options: { env?: NodeJS.ProcessEnv; root?: string; mode?: MaintenanceMode; lock?: FileLock } = {}): Promise<MaintainOutcome> {
  const env = options.env ?? process.env;
  const root = path.resolve(options.root ?? process.cwd());
  const global = await loadGlobalConfig(env);
  if (!global) throw new Error("No global config; run inside a configured project");
  const mode = options.mode ?? "dry-run";
  const projectKey = await deriveProjectKey(root);
  let lock: FileLock | undefined = options.lock;
  try {
    if (mode !== "dry-run" && !lock) lock = await acquireProjectLock(env, projectKey);
    const state = await loadCurationState(env, projectKey);
    if (mode === "resume") {
      const pending = state.maintenanceCursor?.pendingTransaction;
      if (!pending) return { warning: "nothing staged to resume" };
      const entries = parseKnowledgeMarkdown(await readFile(knowledgeFilePath(root, global.knowledgeFile), "utf8"));
      const { issues } = validateTransactionOperations(entries, pending.operations, projectKey);
      const revision = corpusRevision(entries);
      if (pending.baseRevision !== revision || issues.length > 0) {
        await saveCurationState(env, { ...state, maintenanceCursor: { at: new Date().toISOString(), lastTransactionId: state.maintenanceCursor?.lastTransactionId } });
        return { warning: `staged transaction ${pending.transactionId} is stale; it was dropped` };
      }
      return { committed: await commitKnowledgeTransaction(env, root, pending, lock) };
    }
    const plan = await planMaintenance(env, root, global);
    if (mode === "dry-run") return { plan };
    if (plan.operations.length === 0) return { plan, warning: "no maintenance operations proposed" };
    const transaction: KnowledgeTransaction = {
      transactionId: maintenanceTransactionId(plan.baseRevision, plan.operations),
      projectKey,
      baseRevision: plan.baseRevision,
      packetIds: [],
      promptVersion: MAINTENANCE_PROMPT_VERSION,
      modelId: MAINTENANCE_MODEL_ID,
      operations: plan.operations,
      createdAt: new Date().toISOString(),
    };
    return { plan, committed: await commitKnowledgeTransaction(env, root, transaction, lock) };
  } finally {
    if (lock && !options.lock) await lock.release().catch(() => undefined);
  }
}

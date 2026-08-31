import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  applyCuratedEntry,
  corpusRevision,
  deriveEntryId,
  entryDigest,
  parseKnowledgeMarkdown,
  renderKnowledgeMarkdown,
  validateEntry,
  type KnowledgeEntry,
} from "../src/concept.js";
import { boundedCurationState, emptyCurationState, loadCurationState, saveCurationState, type CurationState } from "../src/curation-state.js";
import { commitKnowledgeTransaction, maintainProject } from "../src/maintain.js";
import { clusterCandidates, proposeOperations } from "../src/reconcile.js";
import {
  applyKnowledgeTransaction,
  KnowledgeTransactionSchema,
  parseKnowledgeTransaction,
  validateTransactionOperations,
  type KnowledgeOperation,
  type KnowledgeTransaction,
} from "../src/transaction.js";
import { deriveProjectKey } from "../src/config.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

function entry(overrides: Partial<KnowledgeEntry> & { id: string; title: string }): KnowledgeEntry {
  return validateEntry({ summary: "summary", body: "body text", ...overrides });
}

function tx(operations: KnowledgeOperation[], baseRevision: string, projectKey: string): KnowledgeTransaction {
  return {
    transactionId: "tx-test-1",
    projectKey,
    baseRevision,
    packetIds: ["pkt-1"],
    promptVersion: "test-1",
    modelId: "test",
    operations,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

test("entry digests are stable across render/parse and corpus revisions are order independent", () => {
  const a = entry({ id: "e1", title: "Queue adapter", kind: "gotcha", verifiedAt: "2026-01-02T00:00:00Z", verificationSources: ["cmd: npm test"] });
  const b = entry({ id: "e2", title: "Retry policy" });
  const parsed = parseKnowledgeMarkdown(renderKnowledgeMarkdown([a, b]));
  assert.deepEqual(parsed.map((item) => item.id), [a.id, b.id].sort());
  assert.equal(entryDigest(parsed[0]!), entryDigest(parsed.find((item) => item.id === parsed[0]!.id)!));
  assert.equal(corpusRevision([a, b]), corpusRevision([b, a]));
  const changed = entry({ id: "e1", title: "Queue adapter", body: "different body" });
  assert.notEqual(corpusRevision([a, b]), corpusRevision([changed, b]));
  assert.notEqual(entryDigest(a), entryDigest(changed));
});

test("kind, verifiedAt, and verificationSources round-trip through markdown", () => {
  const original = entry({ id: "e1", title: "Room IDs", kind: "gotcha", verifiedAt: "2026-03-04T05:06:07.000Z", verificationSources: ["cmd: npm test"] });
  const parsed = parseKnowledgeMarkdown(renderKnowledgeMarkdown([original]))[0]!;
  assert.equal(parsed.kind, "gotcha");
  assert.equal(parsed.verifiedAt, "2026-03-04T05:06:07.000Z");
  assert.deepEqual(parsed.verificationSources, ["cmd: npm test"]);
});

test("create derives the entry id on the host", () => {
  const existing = [entry({ id: "e1", title: "Existing" })];
  const result = applyKnowledgeTransaction(existing, tx([{ op: "create", entry: { title: "New Entry", summary: "s", body: "b" } }], corpusRevision(existing), "proj"), "proj");
  assert.deepEqual(result.createdIds, [deriveEntryId("proj", "New Entry")]);
  assert.equal(result.entries.length, 2);
});

test("update applies with a matching digest and rejects a stale digest", () => {
  const target = entry({ id: "e1", title: "Queue adapter", body: "v1" });
  const digest = entryDigest(target);
  const applied = applyKnowledgeTransaction([target], tx([{ op: "update", target: { id: "e1", expectedDigest: digest }, entry: { title: "Queue adapter", summary: "summary", body: "v2" } }], corpusRevision([target]), "p"), "p");
  assert.equal(applied.entries[0]!.body, "v2");
  const stale = validateTransactionOperations([target], [{ op: "update", target: { id: "e1", expectedDigest: "0".repeat(64) }, entry: { title: "Queue adapter", summary: "summary", body: "v2" } }], "p");
  assert.ok(stale.issues.some((issue) => issue.includes("digest mismatch")));
  assert.throws(() => applyKnowledgeTransaction([target], tx([{ op: "update", target: { id: "e1", expectedDigest: "0".repeat(64) }, entry: { title: "Queue adapter", summary: "summary", body: "v2" } }], corpusRevision([target]), "p"), "p"));
});

test("merge keeps the survivor id, tombstones absorbed entries, and rejects missing targets", () => {
  const a = entry({ id: "e1", title: "Ward config", body: "ward: on", verifiedAt: "2026-01-01T00:00:00Z", verificationSources: ["cmd: ls"] });
  const b = entry({ id: "e2", title: "Ward configuration", body: "ward config notes" });
  const digestA = entryDigest(a);
  const digestB = entryDigest(b);
  const result = applyKnowledgeTransaction([a, b], tx([{ op: "merge", targets: [{ id: "e1", expectedDigest: digestA }, { id: "e2", expectedDigest: digestB }], survivorId: "e1", entry: { title: "Ward config", summary: "summary", body: "merged body", verifiedAt: "2026-01-01T00:00:00Z", verificationSources: ["cmd: ls"] }, reason: "duplicate" }], corpusRevision([a, b]), "p"), "p");
  assert.deepEqual(result.entries.map((item) => item.id), ["e1"]);
  assert.equal(result.entries[0]!.body, "merged body");
  assert.equal(result.tombstones.length, 1);
  assert.equal(result.tombstones[0]!.mergedInto, "e1");
  assert.equal(result.tombstones[0]!.op, "merge");
  const missing = validateTransactionOperations([a], [{ op: "merge", targets: [{ id: "e1", expectedDigest: digestA }, { id: "zz", expectedDigest: digestB }], survivorId: "e1", entry: { title: "Ward config", summary: "s", body: "b" }, reason: "duplicate" }], "p");
  assert.ok(missing.issues.some((issue) => issue.includes("target not found: zz")));
});

test("delete requires current verification and records a tombstone", () => {
  const target = entry({ id: "e1", title: "Stale gotcha" });
  const digest = entryDigest(target);
  const schemaCheck = KnowledgeTransactionSchema.safeParse({
    transactionId: "tx", projectKey: "p", baseRevision: "x".repeat(64), packetIds: [], promptVersion: "t", modelId: "m", createdAt: "2026-01-01T00:00:00Z",
    operations: [{ op: "delete", target: { id: "e1", expectedDigest: digest }, reason: "stale" }],
  });
  assert.equal(schemaCheck.success, false);
  const result = applyKnowledgeTransaction([target], tx([{ op: "delete", target: { id: "e1", expectedDigest: digest }, reason: "stale", verification: { verifiedAt: "2026-01-01T00:00:00Z", sources: ["cmd: grep"] } }], corpusRevision([target]), "p"), "p");
  assert.deepEqual(result.entries, []);
  assert.equal(result.tombstones[0]!.op, "delete");
  assert.equal(result.tombstones[0]!.id, "e1");
});

test("keep records a review without semantic change", () => {
  const target = entry({ id: "e1", title: "WrapSheets v1" });
  const digest = entryDigest(target);
  const result = applyKnowledgeTransaction([target], tx([{ op: "keep", target: { id: "e1", expectedDigest: digest }, reason: "verified and current" }], corpusRevision([target]), "p"), "p");
  assert.deepEqual(result.entries, [target]);
  assert.deepEqual(result.tombstones, []);
  assert.deepEqual(result.reviews, []);
});

test("needs-review leaves current guidance untouched and records an open review", () => {
  const target = entry({ id: "e1", title: "Conflicting" });
  const result = applyKnowledgeTransaction([target], tx([{ op: "needs-review", targets: ["e1"], conflict: "two values for mode", nextAction: "verify current truth" }], corpusRevision([target]), "p"), "p");
  assert.deepEqual(result.entries, [target]);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.reviews[0]!.status, "open");
});

test("duplicate target operations are rejected", () => {
  const target = entry({ id: "e1", title: "Queue adapter" });
  const digest = entryDigest(target);
  const operations: KnowledgeOperation[] = [
    { op: "update", target: { id: "e1", expectedDigest: digest }, entry: { title: "Queue adapter", summary: "s", body: "a" } },
    { op: "delete", target: { id: "e1", expectedDigest: digest }, reason: "r", verification: { verifiedAt: "2026-01-01T00:00:00Z", sources: ["cmd: x"] } },
  ];
  const { issues } = validateTransactionOperations([target], operations, "p");
  assert.ok(issues.some((issue) => issue.includes("incompatible mutating operations")));
});

test("invalid payload fails validation before any write", () => {
  const { issues } = validateTransactionOperations([], [{ op: "create", entry: { title: "Bad <!-- cheatcodes-entry -->", summary: "s", body: "b" } }], "p");
  assert.ok(issues.some((issue) => issue.includes("reserved text")));
});

test("stale base revision and concurrent corpus change reject the commit", async () => {
  const root = await temporary();
  await mkdir(path.join(root, ".agents"), { recursive: true });
  try {
    const { env } = await writeGlobalConfig({ inputs: [] });
    const base = [entry({ id: "e1", title: "Queue adapter" })];
    await writeFile(path.join(root, ".agents", "CHEATCODES.md"), renderKnowledgeMarkdown(base));
    const projectKey = await deriveProjectKey(root);
    const digest = entryDigest(base[0]!);
    const transaction = tx([{ op: "delete", target: { id: "e1", expectedDigest: digest }, reason: "stale", verification: { verifiedAt: "2026-01-01T00:00:00Z", sources: ["cmd: x"] } }], corpusRevision(base), projectKey);
    await writeFile(path.join(root, ".agents", "CHEATCODES.md"), renderKnowledgeMarkdown([...base, entry({ id: "e2", title: "Concurrent edit" })]));
    await assert.rejects(() => commitKnowledgeTransaction(env, root, transaction), /stale transaction/);
    const state = await loadCurationState(env, projectKey);
    assert.deepEqual(state.transactions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed validation leaves the corpus and curation state untouched", async () => {
  const root = await temporary();
  await mkdir(path.join(root, ".agents"), { recursive: true });
  try {
    const { env } = await writeGlobalConfig({ inputs: [] });
    const base = [entry({ id: "e1", title: "Queue adapter" })];
    const before = renderKnowledgeMarkdown(base);
    await writeFile(path.join(root, ".agents", "CHEATCODES.md"), before);
    const projectKey = await deriveProjectKey(root);
    const transaction = tx([{ op: "update", target: { id: "e1", expectedDigest: "0".repeat(64) }, entry: { title: "Queue adapter", summary: "s", body: "b" } }], corpusRevision(base), projectKey);
    await assert.rejects(() => commitKnowledgeTransaction(env, root, transaction));
    assert.equal(await readFile(path.join(root, ".agents", "CHEATCODES.md"), "utf8"), before);
    assert.equal(existsSync(path.join(path.dirname(env.CHEATCODES_STATE!), "curation")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge and delete persist tombstones across reloads", async () => {
  const root = await temporary();
  await mkdir(path.join(root, ".agents"), { recursive: true });
  try {
    const { env } = await writeGlobalConfig({ inputs: [] });
    const base = [
      entry({ id: "e1", title: "Cache adapter", body: "cache: lru" }),
      entry({ id: "e2", title: "Cache adapter setup", body: "cache config" }),
    ];
    await writeFile(path.join(root, ".agents", "CHEATCODES.md"), renderKnowledgeMarkdown(base));
    const projectKey = await deriveProjectKey(root);
    const transaction = tx([{ op: "delete", target: { id: "e2", expectedDigest: entryDigest(base[1]!) }, reason: "duplicate", verification: { verifiedAt: "2026-01-01T00:00:00Z", sources: ["cmd: ls"] } }], corpusRevision(base), projectKey);
    const committed = await commitKnowledgeTransaction(env, root, transaction);
    assert.equal(committed.entryCountAfter, 1);
    assert.equal(committed.tombstones, 1);
    const state = await loadCurationState(env, projectKey);
    assert.equal(state.tombstones.length, 1);
    assert.equal(state.tombstones[0]!.id, "e2");
    assert.equal(state.transactions.length, 1);
    assert.equal(state.packetOutcomes["pkt-1"]?.status, "applied");
    const corpus = parseKnowledgeMarkdown(await readFile(path.join(root, ".agents", "CHEATCODES.md"), "utf8"));
    assert.deepEqual(corpus.map((item) => item.id), ["e1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume applies a staged transaction and drops a stale one", async () => {
  const root = await temporary();
  await mkdir(path.join(root, ".agents"), { recursive: true });
  try {
    const { env } = await writeGlobalConfig({ inputs: [] });
    const base = [entry({ id: "e1", title: "Loop entry one" }), entry({ id: "e2", title: "Loop entry two" })];
    await writeFile(path.join(root, ".agents", "CHEATCODES.md"), renderKnowledgeMarkdown(base));
    const projectKey = await deriveProjectKey(root);
    const operations: KnowledgeOperation[] = [{ op: "needs-review", targets: ["e1", "e2"], conflict: "duplicate loop entries", nextAction: "verify" }];
    const staged: CurationState = { ...emptyCurationState(projectKey), revision: corpusRevision(base), maintenanceCursor: { at: "2026-01-01T00:00:00Z", pendingTransaction: tx(operations, corpusRevision(base), projectKey) } };
    await saveCurationState(env, staged);
    const outcome = await maintainProject({ env, root, mode: "resume" });
    assert.equal(outcome.committed?.reviews, 1);
    const state = await loadCurationState(env, projectKey);
    assert.equal(state.maintenanceCursor?.pendingTransaction, undefined);
    assert.equal(state.maintenanceCursor?.lastTransactionId, "tx-test-1");
    const stale: CurationState = { ...emptyCurationState(projectKey), maintenanceCursor: { at: "2026-01-01T00:00:00Z", pendingTransaction: tx(operations, "f".repeat(64), projectKey) } };
    await saveCurationState(env, stale);
    const dropped = await maintainProject({ env, root, mode: "resume" });
    assert.match(dropped.warning ?? "", /stale/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clustering nominates duplicates and contradictions without deciding", () => {
  const verified = entry({ id: "e1", title: "Cache adapter", body: "cache: lru", verifiedAt: "2026-01-01T00:00:00Z", verificationSources: ["cmd: ls"] });
  const unverified = entry({ id: "e2", title: "Cache adapter", body: "cache config notes" });
  const clusters = clusterCandidates([verified, unverified]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]!.kind, "duplicate");
  const mergePlan = proposeOperations(clusters, [verified, unverified]);
  assert.equal(mergePlan[0]!.op, "needs-review");
  const bothVerified = [verified, entry({ id: "e2", title: "Cache adapter", body: "cache config notes", verifiedAt: "2026-01-01T00:00:00Z", verificationSources: ["cmd: ls"] })];
  const merge = proposeOperations(clusterCandidates(bothVerified), bothVerified);
  assert.equal(merge[0]!.op, "merge");
  assert.equal((merge[0] as { survivorId: string }).survivorId, "e1");
  const conflicting = [entry({ id: "e3", title: "Queue mode", body: "mode: sync" }), entry({ id: "e4", title: "Queue mode config", body: "mode: async" })];
  const contradictionClusters = clusterCandidates(conflicting);
  assert.equal(contradictionClusters[0]!.kind, "contradiction");
  const review = proposeOperations(contradictionClusters, conflicting);
  assert.equal(review[0]!.op, "needs-review");
});

test("curation state bounds history and round-trips through disk", async () => {
  const root = await temporary();
  await mkdir(path.join(root, ".agents"), { recursive: true });
  try {
    const { env } = await writeGlobalConfig({ inputs: [] });
    const projectKey = await deriveProjectKey(root);
    const receipts = Array.from({ length: 60 }, (_, index) => ({ transactionId: `t${index}`, at: "2026-01-01T00:00:00Z", baseRevision: "a", resultRevision: "b", applied: [], entryCountBefore: 1, entryCountAfter: 1 }));
    const packetOutcomes = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`p${index}`, { packetId: `p${index}`, at: "2026-01-01T00:00:00Z", status: "applied" as const }]));
    const state: CurationState = { ...emptyCurationState(projectKey), transactions: receipts, packetOutcomes };
    await saveCurationState(env, state);
    const loaded = await loadCurationState(env, projectKey);
    assert.equal(loaded.transactions.length, 50);
    assert.equal(Object.keys(loaded.packetOutcomes).length, 500);
    assert.equal(boundedCurationState(state).transactions.length, 50);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("maintain dry-run reports plan, verification, and resulting count; apply commits once", async () => {
  const root = await temporary();
  await mkdir(path.join(root, ".agents"), { recursive: true });
  try {
    const { env } = await writeGlobalConfig({ inputs: [] });
    const verified = entry({ id: "e1", title: "Cache adapter", body: "cache: lru", verifiedAt: "2026-01-01T00:00:00Z", verificationSources: ["cmd: ls"] });
    const absorbed = entry({ id: "e2", title: "Cache adapter setup", body: "cache config notes", verifiedAt: "2026-01-01T00:00:00Z", verificationSources: ["cmd: ls"] });
    await mkdir(path.join(root, "sessions"), { recursive: true });
    await writeFile(path.join(root, ".agents", "CHEATCODES.md"), renderKnowledgeMarkdown([verified, absorbed, entry({ id: "e3", title: "Queue mode", body: "mode: sync" }), entry({ id: "e4", title: "Queue mode config", body: "mode: async" })]));
    const dryRun = await maintainProject({ env, root, mode: "dry-run" });
    assert.equal(dryRun.plan!.operations.some((op) => op.op === "merge"), true);
    assert.equal(dryRun.plan!.operations.some((op) => op.op === "needs-review"), true);
    assert.deepEqual(dryRun.plan!.reviewedIds, ["e1", "e2"]);
    assert.equal(dryRun.plan!.resultingCount, 3);
    assert.ok(dryRun.plan!.missingVerification.some((item) => item.id === "e3" || item.id === "e4"));
    const applied = await maintainProject({ env, root, mode: "apply" });
    assert.equal(applied.committed!.reviews, 1);
    const corpus = parseKnowledgeMarkdown(await readFile(path.join(root, ".agents", "CHEATCODES.md"), "utf8"));
    assert.equal(corpus.length, 3);
    const second = await maintainProject({ env, root, mode: "apply" });
    assert.equal(second.committed!.reviews, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("transaction schema rejects unknown fields and parses valid transactions", () => {
  const base = { transactionId: "t", projectKey: "p", baseRevision: "a".repeat(64), packetIds: [], promptVersion: "v", modelId: "m", createdAt: "2026-01-01T00:00:00Z", operations: [{ op: "create", entry: { title: "T", summary: "s", body: "b" } }] };
  assert.equal(KnowledgeTransactionSchema.safeParse({ ...base, extra: 1 }).success, false);
  assert.equal(parseKnowledgeTransaction(base).transactionId, "t");
});

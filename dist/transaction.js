import { z } from "zod";
import { deriveEntryId, entryDigest, normalizeTitleKey, validateEntry, corpusRevision, KnowledgeValidationError, } from "./concept.js";
export const KNOWLEDGE_KINDS = ["gotcha", "decision", "procedure", "invariant"];
const EntryPayloadSchema = z
    .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    body: z.string().min(1),
    date: z.string().optional(),
    tags: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
    kind: z.enum(KNOWLEDGE_KINDS).optional(),
    verifiedAt: z.string().optional(),
    verificationSources: z.array(z.string()).optional(),
})
    .strict();
const TargetRefSchema = z.object({ id: z.string().min(1), expectedDigest: z.string().min(8) }).strict();
const CreateOperationSchema = z
    .object({ op: z.literal("create"), entry: EntryPayloadSchema, evidenceRefs: z.array(z.string().min(1)).optional() })
    .strict();
const UpdateOperationSchema = z.object({ op: z.literal("update"), target: TargetRefSchema, entry: EntryPayloadSchema }).strict();
const MergeOperationSchema = z
    .object({
    op: z.literal("merge"),
    targets: z.array(TargetRefSchema).min(2),
    survivorId: z.string().min(1),
    entry: EntryPayloadSchema,
    reason: z.string().min(1),
})
    .strict();
const DeleteOperationSchema = z
    .object({
    op: z.literal("delete"),
    target: TargetRefSchema,
    reason: z.string().min(1),
    verification: z.object({ verifiedAt: z.string().min(1), sources: z.array(z.string().min(1)).min(1) }).strict(),
})
    .strict();
const KeepOperationSchema = z.object({ op: z.literal("keep"), target: TargetRefSchema, reason: z.string().min(1) }).strict();
const NeedsReviewOperationSchema = z
    .object({ op: z.literal("needs-review"), targets: z.array(z.string().min(1)).min(1), conflict: z.string().min(1), nextAction: z.string().min(1) })
    .strict();
export const CreateOperation = CreateOperationSchema;
export const UpdateOperation = UpdateOperationSchema;
export const MergeOperation = MergeOperationSchema;
export const DeleteOperation = DeleteOperationSchema;
export const KeepOperation = KeepOperationSchema;
export const NeedsReviewOperation = NeedsReviewOperationSchema;
export const KnowledgeOperationSchema = z.discriminatedUnion("op", [
    CreateOperationSchema,
    UpdateOperationSchema,
    MergeOperationSchema,
    DeleteOperationSchema,
    KeepOperationSchema,
    NeedsReviewOperationSchema,
]);
export const KnowledgeTransactionSchema = z
    .object({
    transactionId: z.string().min(1),
    projectKey: z.string().min(1),
    baseRevision: z.string().min(8),
    packetIds: z.array(z.string().min(1)),
    promptVersion: z.string().min(1),
    modelId: z.string().min(1),
    operations: z.array(KnowledgeOperationSchema).min(1),
    createdAt: z.string().min(1),
})
    .strict();
export function parseKnowledgeTransaction(value) {
    return KnowledgeTransactionSchema.parse(value);
}
function buildViews(entries) {
    const views = new Map();
    for (const entry of entries)
        views.set(entry.id, { entry, digest: entryDigest(entry) });
    return views;
}
function opTargetIds(op) {
    switch (op.op) {
        case "update":
        case "delete":
        case "keep":
            return [op.target.id];
        case "merge":
            return op.targets.map((target) => target.id);
        case "needs-review":
            return op.targets;
        case "create":
            return [];
    }
}
function payloadEntry(payload, id) {
    return validateEntry({ id, ...payload });
}
function normalizePayload(payload, id, issues, label) {
    try {
        return payloadEntry(payload, id);
    }
    catch (error) {
        if (error instanceof KnowledgeValidationError)
            issues.push(...error.issues.map((issue) => `${label}: ${issue}`));
        else
            issues.push(`${label}: ${error.message}`);
        return undefined;
    }
}
export function validateTransactionOperations(entries, operations, projectKey) {
    const issues = [];
    const views = buildViews(entries);
    const mutating = new Map();
    for (let index = 0; index < operations.length; index++) {
        const op = operations[index];
        const label = `operation[${index}](${op.op})`;
        if (op.op === "create") {
            const id = deriveEntryId(projectKey, op.entry.title);
            if (views.has(id))
                issues.push(`${label}: derived entry id ${id} already exists; use update instead`);
            normalizePayload(op.entry, id, issues, label);
            continue;
        }
        for (const targetId of opTargetIds(op)) {
            const view = views.get(targetId);
            if (!view) {
                issues.push(`${label}: target not found: ${targetId}`);
                continue;
            }
            if (op.op === "needs-review" || op.op === "keep") {
                if (op.op === "keep" && op.target.expectedDigest !== view.digest) {
                    issues.push(`${label}: digest mismatch for ${targetId}`);
                }
                continue;
            }
            mutating.set(targetId, (mutating.get(targetId) ?? 0) + 1);
            const expected = op.op === "merge" ? op.targets.find((target) => target.id === targetId).expectedDigest : op.target.expectedDigest;
            if (expected !== view.digest)
                issues.push(`${label}: digest mismatch for ${targetId}`);
        }
        if (op.op === "merge") {
            const targetIds = new Set(op.targets.map((target) => target.id));
            if (!targetIds.has(op.survivorId))
                issues.push(`${label}: survivor ${op.survivorId} is not one of the merge targets`);
            normalizePayload(op.entry, op.survivorId, issues, label);
        }
        if (op.op === "update")
            normalizePayload(op.entry, op.target.id, issues, label);
        if (op.op === "delete" && Number.isNaN(new Date(op.verification.verifiedAt).getTime())) {
            issues.push(`${label}: verification.verifiedAt must be an ISO 8601 datetime`);
        }
    }
    for (const [targetId, count] of mutating) {
        if (count > 1)
            issues.push(`target ${targetId} has ${count} incompatible mutating operations`);
    }
    return { issues, views };
}
export function applyKnowledgeTransaction(entries, transaction, projectKey) {
    const { issues } = validateTransactionOperations(entries, transaction.operations, projectKey);
    if (issues.length > 0)
        throw new KnowledgeValidationError(issues);
    const result = entries.map((entry) => entry);
    const tombstones = [];
    const reviews = [];
    const createdIds = [];
    for (const op of transaction.operations) {
        if (op.op === "create") {
            const id = deriveEntryId(projectKey, op.entry.title);
            const entry = payloadEntry(op.entry, id);
            result.push(entry);
            createdIds.push(id);
            continue;
        }
        if (op.op === "update") {
            const index = result.findIndex((entry) => entry.id === op.target.id);
            result[index] = payloadEntry(op.entry, op.target.id);
            continue;
        }
        if (op.op === "merge") {
            const survivorIndex = result.findIndex((entry) => entry.id === op.survivorId);
            const survivor = result[survivorIndex];
            result[survivorIndex] = payloadEntry(op.entry, survivor.id);
            for (const target of op.targets) {
                if (target.id === op.survivorId)
                    continue;
                const absorbedIndex = result.findIndex((entry) => entry.id === target.id);
                const [absorbed] = result.splice(absorbedIndex, 1);
                tombstones.push({
                    id: absorbed.id,
                    title: absorbed.title,
                    op: "merge",
                    reason: op.reason,
                    digest: target.expectedDigest,
                    mergedInto: survivor.id,
                    transactionId: transaction.transactionId,
                    removedAt: transaction.createdAt,
                });
            }
            continue;
        }
        if (op.op === "delete") {
            const index = result.findIndex((entry) => entry.id === op.target.id);
            const [removed] = result.splice(index, 1);
            tombstones.push({
                id: removed.id,
                title: removed.title,
                op: "delete",
                reason: op.reason,
                digest: op.target.expectedDigest,
                transactionId: transaction.transactionId,
                removedAt: transaction.createdAt,
            });
            continue;
        }
        if (op.op === "needs-review") {
            reviews.push({
                id: `rev-${transaction.transactionId}-${reviews.length}`,
                targets: [...op.targets],
                conflict: op.conflict,
                nextAction: op.nextAction,
                transactionId: transaction.transactionId,
                createdAt: transaction.createdAt,
                status: "open",
            });
        }
        // keep: records a reviewed decision; no semantic change.
    }
    const finalIds = new Set();
    const finalTitles = new Set();
    for (const entry of result) {
        if (finalIds.has(entry.id))
            issues.push(`resulting entry id is not unique: ${entry.id}`);
        finalIds.add(entry.id);
        const titleKey = normalizeTitleKey(entry.title);
        if (finalTitles.has(titleKey))
            issues.push(`resulting entry title is not unique: ${entry.title}`);
        finalTitles.add(titleKey);
    }
    if (issues.length > 0)
        throw new KnowledgeValidationError(issues);
    return { entries: result, tombstones, reviews, createdIds, resultRevision: corpusRevision(result) };
}

import { z } from "zod";
import { type KnowledgeEntry } from "./concept.js";
import type { ReviewRecord, Tombstone } from "./curation-state.js";
export declare const KNOWLEDGE_KINDS: readonly ["gotcha", "decision", "procedure", "invariant"];
declare const EntryPayloadSchema: z.ZodObject<{
    title: z.ZodString;
    summary: z.ZodString;
    body: z.ZodString;
    date: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kind: z.ZodOptional<z.ZodEnum<{
        gotcha: "gotcha";
        decision: "decision";
        procedure: "procedure";
        invariant: "invariant";
    }>>;
    verifiedAt: z.ZodOptional<z.ZodString>;
    verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
declare const TargetRefSchema: z.ZodObject<{
    id: z.ZodString;
    expectedDigest: z.ZodString;
}, z.core.$strict>;
declare const CreateOperationSchema: z.ZodObject<{
    op: z.ZodLiteral<"create">;
    entry: z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        verifiedAt: z.ZodOptional<z.ZodString>;
        verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    evidenceRefs: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
declare const UpdateOperationSchema: z.ZodObject<{
    op: z.ZodLiteral<"update">;
    target: z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>;
    entry: z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        verifiedAt: z.ZodOptional<z.ZodString>;
        verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>;
declare const MergeOperationSchema: z.ZodObject<{
    op: z.ZodLiteral<"merge">;
    targets: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>>;
    survivorId: z.ZodString;
    entry: z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        verifiedAt: z.ZodOptional<z.ZodString>;
        verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    reason: z.ZodString;
}, z.core.$strict>;
declare const DeleteOperationSchema: z.ZodObject<{
    op: z.ZodLiteral<"delete">;
    target: z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>;
    reason: z.ZodString;
    verification: z.ZodObject<{
        verifiedAt: z.ZodString;
        sources: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
declare const KeepOperationSchema: z.ZodObject<{
    op: z.ZodLiteral<"keep">;
    target: z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>;
    reason: z.ZodString;
}, z.core.$strict>;
declare const NeedsReviewOperationSchema: z.ZodObject<{
    op: z.ZodLiteral<"needs-review">;
    targets: z.ZodArray<z.ZodString>;
    conflict: z.ZodString;
    nextAction: z.ZodString;
}, z.core.$strict>;
export declare const CreateOperation: z.ZodObject<{
    op: z.ZodLiteral<"create">;
    entry: z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        verifiedAt: z.ZodOptional<z.ZodString>;
        verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    evidenceRefs: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const UpdateOperation: z.ZodObject<{
    op: z.ZodLiteral<"update">;
    target: z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>;
    entry: z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        verifiedAt: z.ZodOptional<z.ZodString>;
        verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const MergeOperation: z.ZodObject<{
    op: z.ZodLiteral<"merge">;
    targets: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>>;
    survivorId: z.ZodString;
    entry: z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        verifiedAt: z.ZodOptional<z.ZodString>;
        verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    reason: z.ZodString;
}, z.core.$strict>;
export declare const DeleteOperation: z.ZodObject<{
    op: z.ZodLiteral<"delete">;
    target: z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>;
    reason: z.ZodString;
    verification: z.ZodObject<{
        verifiedAt: z.ZodString;
        sources: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const KeepOperation: z.ZodObject<{
    op: z.ZodLiteral<"keep">;
    target: z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>;
    reason: z.ZodString;
}, z.core.$strict>;
export declare const NeedsReviewOperation: z.ZodObject<{
    op: z.ZodLiteral<"needs-review">;
    targets: z.ZodArray<z.ZodString>;
    conflict: z.ZodString;
    nextAction: z.ZodString;
}, z.core.$strict>;
export type EntryPayload = z.infer<typeof EntryPayloadSchema>;
export type TargetRef = z.infer<typeof TargetRefSchema>;
export type CreateOperation = z.infer<typeof CreateOperationSchema>;
export type UpdateOperation = z.infer<typeof UpdateOperationSchema>;
export type MergeOperation = z.infer<typeof MergeOperationSchema>;
export type DeleteOperation = z.infer<typeof DeleteOperationSchema>;
export type KeepOperation = z.infer<typeof KeepOperationSchema>;
export type NeedsReviewOperation = z.infer<typeof NeedsReviewOperationSchema>;
export type KnowledgeOperation = CreateOperation | UpdateOperation | MergeOperation | DeleteOperation | KeepOperation | NeedsReviewOperation;
export declare const KnowledgeOperationSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    op: z.ZodLiteral<"create">;
    entry: z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        verifiedAt: z.ZodOptional<z.ZodString>;
        verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    evidenceRefs: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>, z.ZodObject<{
    op: z.ZodLiteral<"update">;
    target: z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>;
    entry: z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        verifiedAt: z.ZodOptional<z.ZodString>;
        verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    op: z.ZodLiteral<"merge">;
    targets: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>>;
    survivorId: z.ZodString;
    entry: z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        date: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        verifiedAt: z.ZodOptional<z.ZodString>;
        verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    op: z.ZodLiteral<"delete">;
    target: z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>;
    reason: z.ZodString;
    verification: z.ZodObject<{
        verifiedAt: z.ZodString;
        sources: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    op: z.ZodLiteral<"keep">;
    target: z.ZodObject<{
        id: z.ZodString;
        expectedDigest: z.ZodString;
    }, z.core.$strict>;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    op: z.ZodLiteral<"needs-review">;
    targets: z.ZodArray<z.ZodString>;
    conflict: z.ZodString;
    nextAction: z.ZodString;
}, z.core.$strict>], "op">;
export declare const KnowledgeTransactionSchema: z.ZodObject<{
    transactionId: z.ZodString;
    projectKey: z.ZodString;
    baseRevision: z.ZodString;
    packetIds: z.ZodArray<z.ZodString>;
    promptVersion: z.ZodString;
    modelId: z.ZodString;
    operations: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        op: z.ZodLiteral<"create">;
        entry: z.ZodObject<{
            title: z.ZodString;
            summary: z.ZodString;
            body: z.ZodString;
            date: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
            kind: z.ZodOptional<z.ZodEnum<{
                gotcha: "gotcha";
                decision: "decision";
                procedure: "procedure";
                invariant: "invariant";
            }>>;
            verifiedAt: z.ZodOptional<z.ZodString>;
            verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
        evidenceRefs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>, z.ZodObject<{
        op: z.ZodLiteral<"update">;
        target: z.ZodObject<{
            id: z.ZodString;
            expectedDigest: z.ZodString;
        }, z.core.$strict>;
        entry: z.ZodObject<{
            title: z.ZodString;
            summary: z.ZodString;
            body: z.ZodString;
            date: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
            kind: z.ZodOptional<z.ZodEnum<{
                gotcha: "gotcha";
                decision: "decision";
                procedure: "procedure";
                invariant: "invariant";
            }>>;
            verifiedAt: z.ZodOptional<z.ZodString>;
            verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        op: z.ZodLiteral<"merge">;
        targets: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            expectedDigest: z.ZodString;
        }, z.core.$strict>>;
        survivorId: z.ZodString;
        entry: z.ZodObject<{
            title: z.ZodString;
            summary: z.ZodString;
            body: z.ZodString;
            date: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            sources: z.ZodOptional<z.ZodArray<z.ZodString>>;
            kind: z.ZodOptional<z.ZodEnum<{
                gotcha: "gotcha";
                decision: "decision";
                procedure: "procedure";
                invariant: "invariant";
            }>>;
            verifiedAt: z.ZodOptional<z.ZodString>;
            verificationSources: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
        reason: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        op: z.ZodLiteral<"delete">;
        target: z.ZodObject<{
            id: z.ZodString;
            expectedDigest: z.ZodString;
        }, z.core.$strict>;
        reason: z.ZodString;
        verification: z.ZodObject<{
            verifiedAt: z.ZodString;
            sources: z.ZodArray<z.ZodString>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        op: z.ZodLiteral<"keep">;
        target: z.ZodObject<{
            id: z.ZodString;
            expectedDigest: z.ZodString;
        }, z.core.$strict>;
        reason: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        op: z.ZodLiteral<"needs-review">;
        targets: z.ZodArray<z.ZodString>;
        conflict: z.ZodString;
        nextAction: z.ZodString;
    }, z.core.$strict>], "op">>;
    createdAt: z.ZodString;
}, z.core.$strict>;
export type KnowledgeTransaction = z.infer<typeof KnowledgeTransactionSchema>;
export declare function parseKnowledgeTransaction(value: unknown): KnowledgeTransaction;
export interface ApplyResult {
    entries: KnowledgeEntry[];
    tombstones: Tombstone[];
    reviews: ReviewRecord[];
    createdIds: string[];
    resultRevision: string;
}
interface EntryView {
    entry: KnowledgeEntry;
    digest: string;
}
export declare function validateTransactionOperations(entries: readonly KnowledgeEntry[], operations: readonly KnowledgeOperation[], projectKey: string): {
    issues: string[];
    views: Map<string, EntryView>;
};
export declare function applyKnowledgeTransaction(entries: readonly KnowledgeEntry[], transaction: Pick<KnowledgeTransaction, "operations" | "transactionId" | "createdAt">, projectKey: string): ApplyResult;
export {};

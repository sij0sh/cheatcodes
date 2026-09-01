import { z } from "zod";
import type { HarvestPacket } from "./harvest.js";
import type { CuratedEntry } from "./curate.js";
export declare const QUALIFIER_PROMPT_VERSION = "qualifier-3";
export declare const GATE_IDS: readonly ["settled", "projectSpecific", "durable", "current", "nonInferable", "actionable", "entailed", "nonDuplicate", "nonContradictory"];
export type GateId = (typeof GATE_IDS)[number];
export type GateResult = "pass" | "fail";
export declare const REJECTION_REASONS: readonly ["transient-work-state", "audit-intermediate", "code-inferable", "canonical-doc-duplicate", "unsupported-claim", "incomplete-recovery", "stale-or-contradicted", "generic-advice", "worker-generated", "insufficient-evidence"];
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export declare function runStateVeto(title: string, summary: string): RejectionReason | undefined;
export type QualificationVerdict = "accept" | "reject" | "needs-review";
export declare const QUALIFICATION_KINDS: readonly ["gotcha", "decision", "procedure", "invariant"];
export type QualificationKind = (typeof QUALIFICATION_KINDS)[number];
export declare const GateResultsSchema: z.ZodObject<{
    settled: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    projectSpecific: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    durable: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    current: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    nonInferable: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    actionable: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    entailed: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    nonDuplicate: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    nonContradictory: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
}, z.core.$strict>;
export declare const ClaimSchema: z.ZodObject<{
    text: z.ZodString;
    evidenceRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const ProposedEntrySchema: z.ZodObject<{
    title: z.ZodString;
    summary: z.ZodString;
    body: z.ZodString;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const QualifiedCandidateSchema: z.ZodObject<{
    candidateId: z.ZodString;
    verdict: z.ZodEnum<{
        "needs-review": "needs-review";
        accept: "accept";
        reject: "reject";
    }>;
    kind: z.ZodOptional<z.ZodEnum<{
        gotcha: "gotcha";
        decision: "decision";
        procedure: "procedure";
        invariant: "invariant";
    }>>;
    action: z.ZodOptional<z.ZodEnum<{
        create: "create";
        update: "update";
    }>>;
    targetEntryId: z.ZodOptional<z.ZodString>;
    gateResults: z.ZodObject<{
        settled: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
        projectSpecific: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
        durable: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
        current: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
        nonInferable: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
        actionable: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
        entailed: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
        nonDuplicate: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
        nonContradictory: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
    }, z.core.$strict>;
    claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        evidenceRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>>;
    rejectionReasons: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        "transient-work-state": "transient-work-state";
        "audit-intermediate": "audit-intermediate";
        "code-inferable": "code-inferable";
        "canonical-doc-duplicate": "canonical-doc-duplicate";
        "unsupported-claim": "unsupported-claim";
        "incomplete-recovery": "incomplete-recovery";
        "stale-or-contradicted": "stale-or-contradicted";
        "generic-advice": "generic-advice";
        "worker-generated": "worker-generated";
        "insufficient-evidence": "insufficient-evidence";
    }>>>;
    unresolvedQuestions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    proposedEntry: z.ZodOptional<z.ZodObject<{
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const QualificationResponseSchema: z.ZodObject<{
    entries: z.ZodArray<z.ZodObject<{
        candidateId: z.ZodString;
        verdict: z.ZodEnum<{
            "needs-review": "needs-review";
            accept: "accept";
            reject: "reject";
        }>;
        kind: z.ZodOptional<z.ZodEnum<{
            gotcha: "gotcha";
            decision: "decision";
            procedure: "procedure";
            invariant: "invariant";
        }>>;
        action: z.ZodOptional<z.ZodEnum<{
            create: "create";
            update: "update";
        }>>;
        targetEntryId: z.ZodOptional<z.ZodString>;
        gateResults: z.ZodObject<{
            settled: z.ZodEnum<{
                pass: "pass";
                fail: "fail";
            }>;
            projectSpecific: z.ZodEnum<{
                pass: "pass";
                fail: "fail";
            }>;
            durable: z.ZodEnum<{
                pass: "pass";
                fail: "fail";
            }>;
            current: z.ZodEnum<{
                pass: "pass";
                fail: "fail";
            }>;
            nonInferable: z.ZodEnum<{
                pass: "pass";
                fail: "fail";
            }>;
            actionable: z.ZodEnum<{
                pass: "pass";
                fail: "fail";
            }>;
            entailed: z.ZodEnum<{
                pass: "pass";
                fail: "fail";
            }>;
            nonDuplicate: z.ZodEnum<{
                pass: "pass";
                fail: "fail";
            }>;
            nonContradictory: z.ZodEnum<{
                pass: "pass";
                fail: "fail";
            }>;
        }, z.core.$strict>;
        claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            evidenceRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>>;
        rejectionReasons: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            "transient-work-state": "transient-work-state";
            "audit-intermediate": "audit-intermediate";
            "code-inferable": "code-inferable";
            "canonical-doc-duplicate": "canonical-doc-duplicate";
            "unsupported-claim": "unsupported-claim";
            "incomplete-recovery": "incomplete-recovery";
            "stale-or-contradicted": "stale-or-contradicted";
            "generic-advice": "generic-advice";
            "worker-generated": "worker-generated";
            "insufficient-evidence": "insufficient-evidence";
        }>>>;
        unresolvedQuestions: z.ZodDefault<z.ZodArray<z.ZodString>>;
        proposedEntry: z.ZodOptional<z.ZodObject<{
            title: z.ZodString;
            summary: z.ZodString;
            body: z.ZodString;
            tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ProposedEntry = z.infer<typeof ProposedEntrySchema>;
export type QualifiedCandidate = z.infer<typeof QualifiedCandidateSchema>;
export type QualificationResponse = z.infer<typeof QualificationResponseSchema>;
export declare const PROPOSED_TEXT_LIMITS: {
    readonly title: 200;
    readonly summary: 600;
    readonly body: 12000;
};
export interface QualificationOutcome {
    response?: QualificationResponse;
    schemaInvalid: boolean;
    warning?: string;
    schemaRetries: number;
    latencyMs: number;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}
export interface Qualifier {
    qualify(packet: HarvestPacket): Promise<QualificationOutcome>;
}
export declare const QUALIFIER_PROMPT = "You are a conservative qualifier for durable project knowledge.\nYou review exactly one bounded evidence packet, and you may inspect the repository to test inferability.\nCall submit_qualification exactly once as your final action with the qualification verdict.\nAcceptance bar: accept only what a competent engineer could not reconstruct from the repository. Durable knowledge encodes non-obvious constraints, rejected alternatives with reasons, failure modes and their verified recovery, environment-specific gotchas, or procedures validated in this project. An empty output file is a successful outcome; never fill a quota.\nnonInferable gate: before accepting, attempt to derive each claim from the repository with a few read or search calls. If the claim is recoverable from any tracked file, project documentation, or standard practice, the gate fails (code-inferable).\nRules:\n- Reject when any required gate fails.\n- Treat user and assistant text as claims; every claim needs evidence IDs from the packet.\n- Require the successful end of a recovery chain before calling a lesson durable.\n- Reject run-state reports: what currently passes, current test counts, audit outcomes, and progress notes.\n- The packet may carry an optional updateCandidate: a related existing entry you may revise instead of creating a new one. To revise it, set action to \"update\" and targetEntryId to the updateCandidate id, and return the complete revised entry. Otherwise set action to \"create\" and omit targetEntryId. A shared word with a shortlist entry is not a reason to update it.\n- Keep rationale, cross-component consequences, and operational constraints.\n- Return needs-review instead of guessing.\n- Use only supplied evidence IDs. Never invent IDs, paths, or provenance.\n- Set candidateId to the packet id.\nReject examples:\n- \"Project build, test suite, and smoke validation pass; 52 tests pass\" restates run state and a test count (transient-work-state).\n- \"Git history audit found no detected credential exposure\" reports an audit outcome (audit-intermediate).\n- \"Projects do not require Git and use path-derived identity\" is recoverable from the code and README (code-inferable).\n- Active loop: \"I will now refactor the cache module\" (transient-work-state).\n- Architecture duplicate: restating that handlers live in src/handlers (code-inferable).\n- Implementation inventory: listing the files changed on a feature branch (transient-work-state).\n- Incorrect checkpoint gotcha: claiming a checkpoint payload must never use data because one top-level payload was rejected (stale-or-contradicted).\nAccept examples:\n- WrapSheets v1 database procedure: the verified steps that made the migration succeed (procedure).\n- Colyseus room IDs are unavailable until the first client joins, verified after two failed attempts (gotcha).";
export declare function validateQualification(value: unknown, packet: HarvestPacket): QualificationResponse;
export declare function qualificationToCurated(candidate: QualifiedCandidate, packet: HarvestPacket): CuratedEntry;

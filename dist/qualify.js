import { z } from "zod";
import { RESERVED_TEXT } from "./concept.js";
export const QUALIFIER_PROMPT_VERSION = "qualifier-3";
export const GATE_IDS = [
    "settled",
    "projectSpecific",
    "durable",
    "current",
    "nonInferable",
    "actionable",
    "entailed",
    "nonDuplicate",
    "nonContradictory",
];
export const REJECTION_REASONS = [
    "transient-work-state",
    "audit-intermediate",
    "code-inferable",
    "canonical-doc-duplicate",
    "unsupported-claim",
    "incomplete-recovery",
    "stale-or-contradicted",
    "generic-advice",
    "worker-generated",
    "insufficient-evidence",
];
// Deterministic veto (audit P0-1): titles or summaries that report run state are never durable
// knowledge, whatever the qualifier model decides. Applied to title and summary only; a body may
// discuss past runs while the claim itself stays durable.
const RUN_STATE_VETO_PATTERNS = [
    { pattern: /\b(?:build|tests?|test suite|validation|smoke(?: test)?|suite|checks?)\b[^.]{0,80}?\bpass(?:es|ed)?\b/i, reason: "transient-work-state" },
    { pattern: /\bpass(?:es|ed)?\b[^.]{0,80}?\b(?:tests?|suite|validation)\b/i, reason: "transient-work-state" },
    { pattern: /\baudits?\b[^.]{0,80}\b(?:found|reports?|detected)\b/i, reason: "audit-intermediate" },
    { pattern: /\bno detected\b/i, reason: "audit-intermediate" },
];
export function runStateVeto(title, summary) {
    const text = `${title}\n${summary}`;
    for (const { pattern, reason } of RUN_STATE_VETO_PATTERNS)
        if (pattern.test(text))
            return reason;
    return undefined;
}
export const QUALIFICATION_KINDS = ["gotcha", "decision", "procedure", "invariant"];
const GateResultSchema = z.enum(["pass", "fail"]);
export const GateResultsSchema = z
    .object({
    settled: GateResultSchema,
    projectSpecific: GateResultSchema,
    durable: GateResultSchema,
    current: GateResultSchema,
    nonInferable: GateResultSchema,
    actionable: GateResultSchema,
    entailed: GateResultSchema,
    nonDuplicate: GateResultSchema,
    nonContradictory: GateResultSchema,
})
    .strict();
export const ClaimSchema = z
    .object({ text: z.string().min(1), evidenceRefs: z.array(z.string().min(1)).default([]) })
    .strict();
export const ProposedEntrySchema = z
    .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    body: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
})
    .strict();
export const QualifiedCandidateSchema = z
    .object({
    candidateId: z.string().min(1),
    verdict: z.enum(["accept", "reject", "needs-review"]),
    kind: z.enum(QUALIFICATION_KINDS).optional(),
    action: z.enum(["create", "update"]).optional(),
    targetEntryId: z.string().min(1).optional(),
    gateResults: GateResultsSchema,
    claims: z.array(ClaimSchema).default([]),
    rejectionReasons: z.array(z.enum(REJECTION_REASONS)).default([]),
    unresolvedQuestions: z.array(z.string().min(1)).default([]),
    proposedEntry: ProposedEntrySchema.optional(),
})
    .strict();
export const QualificationResponseSchema = z.object({ entries: z.array(QualifiedCandidateSchema) }).strict();
export const PROPOSED_TEXT_LIMITS = { title: 200, summary: 600, body: 12000 };
export const QUALIFIER_PROMPT = `You are a conservative qualifier for durable project knowledge.
You review exactly one bounded evidence packet, and you may inspect the repository to test inferability.
Call submit_qualification exactly once as your final action with the qualification verdict.
Acceptance bar: accept only what a competent engineer could not reconstruct from the repository. Durable knowledge encodes non-obvious constraints, rejected alternatives with reasons, failure modes and their verified recovery, environment-specific gotchas, or procedures validated in this project. An empty output file is a successful outcome; never fill a quota.
nonInferable gate: before accepting, attempt to derive each claim from the repository with a few read or search calls. If the claim is recoverable from any tracked file, project documentation, or standard practice, the gate fails (code-inferable).
Rules:
- Reject when any required gate fails.
- Treat user and assistant text as claims; every claim needs evidence IDs from the packet.
- Require the successful end of a recovery chain before calling a lesson durable.
- Reject run-state reports: what currently passes, current test counts, audit outcomes, and progress notes.
- The packet may carry an optional updateCandidate: a related existing entry you may revise instead of creating a new one. To revise it, set action to "update" and targetEntryId to the updateCandidate id, and return the complete revised entry. Otherwise set action to "create" and omit targetEntryId. A shared word with a shortlist entry is not a reason to update it.
- Keep rationale, cross-component consequences, and operational constraints.
- Return needs-review instead of guessing.
- Use only supplied evidence IDs. Never invent IDs, paths, or provenance.
- Set candidateId to the packet id.
Reject examples:
- "Project build, test suite, and smoke validation pass; 52 tests pass" restates run state and a test count (transient-work-state).
- "Git history audit found no detected credential exposure" reports an audit outcome (audit-intermediate).
- "Projects do not require Git and use path-derived identity" is recoverable from the code and README (code-inferable).
- Active loop: "I will now refactor the cache module" (transient-work-state).
- Architecture duplicate: restating that handlers live in src/handlers (code-inferable).
- Implementation inventory: listing the files changed on a feature branch (transient-work-state).
- Incorrect checkpoint gotcha: claiming a checkpoint payload must never use data because one top-level payload was rejected (stale-or-contradicted).
Accept examples:
- WrapSheets v1 database procedure: the verified steps that made the migration succeed (procedure).
- Colyseus room IDs are unavailable until the first client joins, verified after two failed attempts (gotcha).`;
export function validateQualification(value, packet) {
    const parsed = QualificationResponseSchema.parse(value);
    const issues = [];
    const evidenceIds = new Set(packet.evidence.map((item) => item.id));
    if (parsed.entries.length > 1)
        issues.push("at most one qualification per packet");
    for (const candidate of parsed.entries) {
        if (candidate.candidateId !== packet.id)
            issues.push(`candidateId must be the packet id ${packet.id}`);
        if (candidate.action === "update") {
            if (!candidate.targetEntryId)
                issues.push("Update action requires targetEntryId");
            else if (!packet.updateCandidate || packet.updateCandidate.id !== candidate.targetEntryId) {
                issues.push("Update target is not the packet update candidate");
            }
        }
        else if (candidate.targetEntryId !== undefined) {
            issues.push("targetEntryId is allowed only for update");
        }
        if (candidate.verdict === "accept" && candidate.proposedEntry) {
            const veto = runStateVeto(candidate.proposedEntry.title, candidate.proposedEntry.summary);
            if (veto) {
                candidate.verdict = "reject";
                candidate.rejectionReasons = [veto];
                delete candidate.proposedEntry;
            }
        }
        for (const claim of candidate.claims) {
            for (const reference of claim.evidenceRefs) {
                if (!evidenceIds.has(reference))
                    issues.push(`Unknown evidence reference: ${reference}`);
            }
        }
        if (candidate.verdict === "accept") {
            const failed = GATE_IDS.filter((gate) => candidate.gateResults[gate] === "fail");
            if (failed.length > 0)
                issues.push(`accepted candidate has failed gates: ${failed.join(",")}`);
            if (candidate.claims.length === 0)
                issues.push("accepted candidate requires claims");
            for (const [index, claim] of candidate.claims.entries()) {
                if (claim.evidenceRefs.length === 0)
                    issues.push(`accepted claim ${index} requires evidence`);
            }
            if (!candidate.proposedEntry)
                issues.push("accepted candidate requires proposedEntry");
            if (candidate.rejectionReasons.length > 0)
                issues.push("accepted candidate must not carry rejection reasons");
            if (candidate.proposedEntry)
                checkProposedText(candidate.proposedEntry, issues);
        }
        if (candidate.verdict === "reject") {
            if (candidate.rejectionReasons.length === 0)
                issues.push("rejected candidate requires a stable rejection reason");
            if (candidate.proposedEntry)
                issues.push("proposedEntry is allowed only for accept");
        }
        if (candidate.verdict === "needs-review") {
            if (candidate.unresolvedQuestions.length === 0)
                issues.push("needs-review requires unresolved questions");
            if (candidate.proposedEntry)
                issues.push("proposedEntry is allowed only for accept");
        }
    }
    if (issues.length > 0)
        throw new Error(issues.join("; "));
    return parsed;
}
function checkProposedText(entry, issues) {
    const fields = [
        ["title", entry.title, PROPOSED_TEXT_LIMITS.title],
        ["summary", entry.summary, PROPOSED_TEXT_LIMITS.summary],
        ["body", entry.body, PROPOSED_TEXT_LIMITS.body],
    ];
    for (const [field, text, limit] of fields) {
        for (const marker of RESERVED_TEXT) {
            if (text.includes(marker)) {
                issues.push(`${field} must not contain reserved text: ${marker.trim()}`);
                break;
            }
        }
        if (text.length > limit)
            issues.push(`${field} exceeds ${limit} characters`);
    }
}
export function qualificationToCurated(candidate, packet) {
    if (candidate.verdict !== "accept" || !candidate.proposedEntry) {
        throw new Error("only accepted candidates with a proposed entry adapt to curated actions");
    }
    const evidenceRefs = [...new Set(candidate.claims.flatMap((claim) => claim.evidenceRefs))];
    if (evidenceRefs.length === 0)
        throw new Error("accepted candidate has no evidence references");
    const targetId = candidate.action === "update" && candidate.targetEntryId !== undefined && packet.updateCandidate?.id === candidate.targetEntryId
        ? candidate.targetEntryId
        : undefined;
    return {
        action: targetId !== undefined ? "update" : "create",
        targetEntryId: targetId,
        title: candidate.proposedEntry.title,
        summary: candidate.proposedEntry.summary,
        body: candidate.proposedEntry.body,
        tags: candidate.proposedEntry.tags,
        evidenceRefs,
    };
}

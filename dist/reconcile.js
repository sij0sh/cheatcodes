import { createHash } from "node:crypto";
import { entryDigest, normalizeTitleKey } from "./concept.js";
const STOP_WORDS = new Set(["the", "and", "for", "with", "when", "that", "this", "from", "into", "not", "use", "using", "how", "why", "are", "you", "your", "can", "will", "all", "any"]);
function titleTokens(title) {
    return new Set(normalizeTitleKey(title).split(" ").filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}
function bodyTerms(body) {
    return new Set(body
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((term) => term.length > 3 && !STOP_WORDS.has(term)));
}
function jaccard(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let shared = 0;
    for (const item of a)
        if (b.has(item))
            shared++;
    return shared / (a.size + b.size - shared);
}
function configValues(body) {
    const values = new Map();
    for (const match of body.matchAll(/([A-Za-z_][\w.-]*)\s*[:=]\s*([^\s;`,]+)/g)) {
        const key = match[1].toLowerCase();
        const value = match[2];
        const known = values.get(key) ?? new Set();
        known.add(value);
        values.set(key, known);
    }
    return values;
}
function pairReasons(a, b) {
    const reasons = [];
    const aTokens = titleTokens(a.title);
    const bTokens = titleTokens(b.title);
    const titleOverlap = jaccard(aTokens, bTokens);
    const contained = aTokens.size > 0 && bTokens.size > 0 && ([...aTokens].every((token) => bTokens.has(token)) || [...bTokens].every((token) => aTokens.has(token)));
    if (titleOverlap >= 0.6 || contained)
        reasons.push("similar titles");
    const sharedTags = (a.tags ?? []).filter((tag) => (b.tags ?? []).includes(tag));
    if (sharedTags.length > 0)
        reasons.push(`shared tags: ${sharedTags.join(", ")}`);
    const sharedSources = (a.sources ?? []).filter((source) => (b.sources ?? []).includes(source));
    if (sharedSources.length > 0)
        reasons.push("shared sources");
    if (jaccard(bodyTerms(a.body), bodyTerms(b.body)) >= 0.5)
        reasons.push("overlapping bodies");
    const aValues = configValues(a.body);
    for (const [key, values] of configValues(b.body)) {
        const known = aValues.get(key);
        if (!known)
            continue;
        for (const value of values) {
            if (!known.has(value)) {
                reasons.push(`conflicting configuration: ${key} (${[...known][0]} vs ${value})`);
                break;
            }
        }
    }
    return reasons;
}
function clusterId(entryIds) {
    return `cl-${createHash("sha256").update(entryIds.join("\u0000")).digest("hex").slice(0, 12)}`;
}
export function clusterCandidates(entries) {
    const parent = new Map();
    const find = (id) => {
        const root = parent.get(id) ?? id;
        if (root === id)
            return id;
        const top = find(root);
        parent.set(id, top);
        return top;
    };
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb)
            parent.set(ra > rb ? rb : ra, ra > rb ? ra : rb);
    };
    for (const entry of entries)
        parent.set(entry.id, entry.id);
    const reasonsByRoot = new Map();
    const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            const reasons = pairReasons(sorted[i], sorted[j]);
            if (reasons.length === 0)
                continue;
            union(sorted[i].id, sorted[j].id);
            const root = find(sorted[i].id);
            const known = reasonsByRoot.get(root) ?? [];
            for (const reason of reasons)
                if (!known.includes(reason))
                    known.push(reason);
            reasonsByRoot.set(root, known);
        }
    }
    const members = new Map();
    for (const entry of sorted) {
        const root = find(entry.id);
        members.set(root, [...(members.get(root) ?? []), entry.id]);
    }
    const clusters = [];
    for (const [root, entryIds] of members) {
        if (entryIds.length < 2)
            continue;
        const reasons = reasonsByRoot.get(root) ?? [];
        clusters.push({
            id: clusterId(entryIds),
            kind: reasons.some((reason) => reason.startsWith("conflicting configuration")) ? "contradiction" : "duplicate",
            entryIds,
            reasons,
        });
    }
    return clusters.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function digestFor(entries, id) {
    const entry = entries.find((candidate) => candidate.id === id);
    return entry ? entryDigest(entry) : undefined;
}
function isVerified(entry) {
    return entry.verifiedAt !== undefined && (entry.verificationSources ?? []).length > 0;
}
export function pickSurvivor(entries, ids) {
    const members = ids.map((id) => entries.find((entry) => entry.id === id));
    return [...members].sort((a, b) => {
        const verified = Number(isVerified(b)) - Number(isVerified(a));
        if (verified !== 0)
            return verified;
        const date = (b.date ?? "").localeCompare(a.date ?? "");
        if (date !== 0)
            return date;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })[0];
}
export function proposeOperations(clusters, entries) {
    const operations = [];
    for (const cluster of clusters) {
        if (cluster.kind === "contradiction") {
            operations.push({
                op: "needs-review",
                targets: [...cluster.entryIds],
                conflict: cluster.reasons.join("; "),
                nextAction: "verify current truth and keep the correct configuration",
            });
            continue;
        }
        const survivor = pickSurvivor(entries, cluster.entryIds);
        const absorbed = cluster.entryIds.filter((id) => id !== survivor.id);
        const allAbsorbedVerified = absorbed.every((id) => isVerified(entries.find((entry) => entry.id === id)));
        if (!allAbsorbedVerified) {
            operations.push({
                op: "needs-review",
                targets: [...cluster.entryIds],
                conflict: cluster.reasons.join("; "),
                nextAction: `verify absorbed entries before merging into ${survivor.id}`,
            });
            continue;
        }
        operations.push({
            op: "merge",
            targets: cluster.entryIds.map((id) => ({ id, expectedDigest: digestFor(entries, id) })),
            survivorId: survivor.id,
            entry: {
                title: survivor.title,
                summary: survivor.summary,
                body: survivor.body,
                ...(survivor.date ? { date: survivor.date } : {}),
                ...(survivor.tags ? { tags: survivor.tags } : {}),
                ...(survivor.sources ? { sources: survivor.sources } : {}),
                ...(survivor.kind ? { kind: survivor.kind } : {}),
                ...(survivor.verifiedAt ? { verifiedAt: survivor.verifiedAt } : {}),
                ...(survivor.verificationSources ? { verificationSources: survivor.verificationSources } : {}),
            },
            reason: cluster.reasons.join("; "),
        });
    }
    return operations;
}

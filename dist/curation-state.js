import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, globalStatePath } from "./state.js";
export const CURATION_STATE_LIMITS = {
    receipts: 50,
    packetOutcomes: 500,
    resolvedReviews: 100,
    tombstones: 1000,
};
export function emptyCurationState(projectKey, revision = "") {
    return { version: 1, projectKey, revision, packetOutcomes: {}, tombstones: [], reviews: [], transactions: [] };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isCurationState(value, projectKey) {
    if (!isRecord(value))
        return false;
    if (value.version !== 1)
        return false;
    if (typeof value.projectKey !== "string")
        return false;
    if (projectKey !== undefined && value.projectKey !== projectKey)
        return false;
    if (!isRecord(value.packetOutcomes) || !Array.isArray(value.tombstones) || !Array.isArray(value.reviews) || !Array.isArray(value.transactions))
        return false;
    if (value.maintenanceCursor !== undefined && !isRecord(value.maintenanceCursor))
        return false;
    if (value.mapCursor !== undefined && !isRecord(value.mapCursor))
        return false;
    return true;
}
export function curationStatePath(env, projectKey) {
    const safe = projectKey.replace(/[^A-Za-z0-9._-]/g, "-");
    return path.join(path.dirname(globalStatePath(env)), "curation", `${safe}.json`);
}
export function boundedCurationState(state) {
    const packetEntries = Object.entries(state.packetOutcomes);
    const bounded = {
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
/**
 * Fails closed: only a missing file means a fresh project. Any other read or
 * validation failure throws, because a silent empty state would let the next
 * commit overwrite tombstones, reviews, and receipts.
 */
export async function loadCurationState(env, projectKey) {
    const file = curationStatePath(env, projectKey);
    let raw;
    try {
        raw = JSON.parse(await readFile(file, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return emptyCurationState(projectKey);
        throw new Error(`curation state ${file} is unreadable; restore or remove it before running: ${error.message}`);
    }
    if (!isCurationState(raw, projectKey)) {
        throw new Error(`curation state ${file} is invalid (wrong version, shape, or projectKey); restore or remove it before running`);
    }
    return raw;
}
export async function saveCurationState(env, state) {
    const file = curationStatePath(env, state.projectKey);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, JSON.stringify(boundedCurationState(state), null, 2));
}

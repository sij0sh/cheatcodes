import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { corpusRevision, parseKnowledgeDocument, removeEntriesFromSessions, renderKnowledgeDocument } from "../concept.js";
import { deriveProjectKey, knowledgeFilePath, loadGlobalConfig, resolveGlobalInputs, resolveProjectRoots } from "../config.js";
import { createPacket, segmentSession } from "../harvest.js";
import { parseJsonlFile, WORKER_ORIGIN } from "../jsonl.js";
import { scanInputs } from "../scan.js";
import { acquireProjectLock, atomicWrite, loadGlobalState, sha256, updateProjectState } from "../state.js";
export const MANIFEST_VERSION = 1;
export const MAX_MANIFEST_PACKETS = 8;
export const workflowDir = (root) => path.join(root, ".agents", "cheatcode-runs");
export const manifestPath = (root, id) => path.join(workflowDir(root), `${id}.json`);
function isManifest(value) {
    const raw = value;
    return raw?.version === 1 && typeof raw.id === "string" && typeof raw.projectKey === "string"
        && typeof raw.corpusRevision === "string" && Array.isArray(raw.packets)
        && typeof raw.cursors === "object" && raw.cursors !== null;
}
/** Manifest ids are content hashes; anything else is rejected before it touches the filesystem. */
export function isManifestId(id) {
    return /^[a-f0-9]{16,64}$/.test(id);
}
export async function readManifest(root, id) {
    if (!isManifestId(id))
        return undefined;
    try {
        const raw = JSON.parse(await readFile(manifestPath(root, id), "utf8"));
        return isManifest(raw) ? raw : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Collect harvested episodes into one immutable, content-addressed manifest.
 * Cursors are recorded but not committed; the host commits them only after the
 * workflow reaches terminal success, so a parked run replays the same manifest.
 */
export async function buildManifest(options = {}) {
    const env = options.env ?? process.env;
    const root = path.resolve(options.root ?? process.cwd());
    const global = await loadGlobalConfig(env);
    if (!global)
        throw new Error(`No global config; run cheatcodes workflow inside a configured project`);
    const projectKey = await deriveProjectKey(root);
    const lock = await acquireProjectLock(env, projectKey);
    const warnings = [];
    try {
        const knowledgeFile = knowledgeFilePath(root, global.knowledgeFile);
        let entries = [];
        let regions = { preamble: "", gaps: [], trailing: "" };
        try {
            const document = parseKnowledgeDocument(await readFile(knowledgeFile, "utf8"));
            entries = document.entries;
            regions = document.regions;
        }
        catch {
            // A missing or malformed corpus starts empty; it is only rewritten when foreign entries are removed.
        }
        const globalState = await loadGlobalState(env);
        const projectState = globalState.projects[projectKey] ?? { files: {} };
        const inputs = resolveGlobalInputs(global, env);
        const projectRoots = resolveProjectRoots(global, root, projectKey);
        const scan = await scanInputs(inputs, projectRoots, projectState.files);
        const isolated = removeEntriesFromSessions(entries, scan.foreignSessionIds);
        if (isolated.removed > 0) {
            entries = isolated.entries;
            await atomicWrite(knowledgeFile, renderKnowledgeDocument({ entries, regions }));
            warnings.push(`Removed ${isolated.removed} knowledge entr${isolated.removed === 1 ? "y" : "ies"} sourced from sessions outside configured project roots`);
        }
        const revision = corpusRevision(entries);
        scan.skipped.forEach((item) => warnings.push(`${item.file}: ${item.message}`));
        scan.missing.forEach((file) => warnings.push(`${file}: configured input does not exist`));
        const packets = [];
        const cursors = {};
        for (const candidate of scan.changed) {
            if (packets.length >= MAX_MANIFEST_PACKETS)
                break;
            const cursor = projectState.files[candidate.file];
            const parsed = await parseJsonlFile(candidate.file, {
                previousCommittedOffset: cursor?.committedOffset ?? 0,
                projectId: projectKey,
                projectRoots,
            });
            for (const item of parsed.warnings)
                warnings.push(`${item.file ?? candidate.file}: ${item.message}`);
            if (parsed.origin === WORKER_ORIGIN) {
                warnings.push(`${candidate.file}: cheatcodes-worker session excluded from harvest`);
                continue;
            }
            let truncated = false;
            for (const episode of segmentSession(parsed)) {
                if (packets.length >= MAX_MANIFEST_PACKETS) {
                    truncated = true;
                    break;
                }
                const packet = createPacket(episode, { projectKey, entries });
                if (packet)
                    packets.push(packet);
            }
            // A truncated file keeps its cursor: unevaluated episodes must rescan.
            if (truncated)
                continue;
            cursors[candidate.file] = {
                sessionId: parsed.sessionId,
                committedOffset: parsed.completeOffset,
                observedSize: candidate.size,
                mtimeMs: candidate.mtimeMs,
                prefixSha256: parsed.completeSha256,
            };
        }
        if (packets.length === 0)
            return { scannedFiles: scan.changed.length, warnings };
        const id = sha256(JSON.stringify([MANIFEST_VERSION, projectKey, revision, packets.map((packet) => packet.id)])).slice(0, 32);
        const manifest = {
            version: 1, id, projectKey, corpusRevision: revision,
            createdAt: new Date().toISOString(), packets, cursors,
        };
        await mkdir(workflowDir(root), { recursive: true });
        await atomicWrite(manifestPath(root, id), JSON.stringify(manifest, null, 2));
        return { manifest, scannedFiles: scan.changed.length, warnings };
    }
    finally {
        await lock.release();
    }
}
/** Commit the cursors recorded by a manifest; only ever moves offsets forward. */
export async function commitManifestCursors(options) {
    const env = options.env ?? process.env;
    const projectKey = options.manifest.projectKey;
    const manifest = options.manifest;
    const lock = await acquireProjectLock(env, projectKey);
    try {
        await updateProjectState(env, projectKey, (project) => {
            const files = { ...project.files };
            for (const [file, cursor] of Object.entries(manifest.cursors)) {
                const existing = files[file];
                if (existing && existing.committedOffset > cursor.committedOffset)
                    continue;
                files[file] = cursor;
            }
            return { ...project, files };
        });
        return Object.keys(manifest.cursors).length;
    }
    finally {
        await lock.release();
    }
}

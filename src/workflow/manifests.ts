import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { corpusRevision, parseKnowledgeMarkdown, type KnowledgeEntry } from "../concept.js";
import { deriveProjectKey, knowledgeFilePath, loadGlobalConfig, resolveGlobalInputs, resolveProjectRoots } from "../config.js";
import { createPacket, segmentSession, type HarvestPacket } from "../harvest.js";
import { parseJsonlFile, WORKER_ORIGIN } from "../jsonl.js";
import { scanInputs } from "../scan.js";
import { acquireProjectLock, atomicWrite, loadGlobalState, sha256, updateProjectState, type FileCursor } from "../state.js";

export const MANIFEST_VERSION = 1;
export const MAX_MANIFEST_PACKETS = 8;

export const workflowDir = (root: string): string => path.join(root, ".agents", "cheatcode-runs");
export const manifestPath = (root: string, id: string): string => path.join(workflowDir(root), `${id}.json`);

export interface EpisodeManifest {
  version: 1;
  id: string;
  projectKey: string;
  corpusRevision: string;
  createdAt: string;
  packets: HarvestPacket[];
  cursors: Record<string, FileCursor>;
}

function isManifest(value: unknown): value is EpisodeManifest {
  const raw = value as EpisodeManifest | undefined;
  return raw?.version === 1 && typeof raw.id === "string" && typeof raw.projectKey === "string"
    && typeof raw.corpusRevision === "string" && Array.isArray(raw.packets)
    && typeof raw.cursors === "object" && raw.cursors !== null;
}

/** Manifest ids are content hashes; anything else is rejected before it touches the filesystem. */
export function isManifestId(id: string): boolean {
  return /^[a-f0-9]{16,64}$/.test(id);
}

export async function readManifest(root: string, id: string): Promise<EpisodeManifest | undefined> {
  if (!isManifestId(id)) return undefined;
  try {
    const raw: unknown = JSON.parse(await readFile(manifestPath(root, id), "utf8"));
    return isManifest(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

export interface ManifestBuild {
  manifest?: EpisodeManifest;
  scannedFiles: number;
  warnings: string[];
}

/**
 * Collect harvested episodes into one immutable, content-addressed manifest.
 * Cursors are recorded but not committed; the host commits them only after the
 * workflow reaches terminal success, so a parked run replays the same manifest.
 */
export async function buildManifest(options: { root?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ManifestBuild> {
  const env = options.env ?? process.env;
  const root = path.resolve(options.root ?? process.cwd());
  const global = await loadGlobalConfig(env);
  if (!global) throw new Error(`No global config; run cheatcodes workflow inside a configured project`);
  const projectKey = await deriveProjectKey(root);
  const lock = await acquireProjectLock(env, projectKey);
  const warnings: string[] = [];
  try {
    const knowledgeFile = knowledgeFilePath(root, global.knowledgeFile);
    let entries: KnowledgeEntry[] = [];
    try { entries = parseKnowledgeMarkdown(await readFile(knowledgeFile, "utf8")); } catch { entries = []; }
    const revision = corpusRevision(entries);
    const globalState = await loadGlobalState(env);
    const projectState = globalState.projects[projectKey] ?? { files: {} };
    const inputs = resolveGlobalInputs(global, env);
    const projectRoots = resolveProjectRoots(global, root, projectKey);
    const scan = await scanInputs(inputs, projectRoots, projectState.files);
    scan.skipped.forEach((item) => warnings.push(`${item.file}: ${item.message}`));
    scan.missing.forEach((file) => warnings.push(`${file}: configured input does not exist`));
    const packets: HarvestPacket[] = [];
    const cursors: Record<string, FileCursor> = {};
    for (const candidate of scan.changed) {
      if (packets.length >= MAX_MANIFEST_PACKETS) break;
      const cursor = projectState.files[candidate.file];
      const parsed = await parseJsonlFile(candidate.file, {
        previousCommittedOffset: cursor?.committedOffset ?? 0,
        projectId: projectKey,
        projectRoots,
      });
      for (const item of parsed.warnings) warnings.push(`${item.file ?? candidate.file}: ${item.message}`);
      if (parsed.origin === WORKER_ORIGIN) {
        warnings.push(`${candidate.file}: cheatcodes-worker session excluded from harvest`);
        continue;
      }
      let truncated = false;
      for (const episode of segmentSession(parsed)) {
        if (packets.length >= MAX_MANIFEST_PACKETS) { truncated = true; break; }
        const packet = createPacket(episode, { projectKey, entries });
        if (packet) packets.push(packet);
      }
      // A truncated file keeps its cursor: unevaluated episodes must rescan.
      if (truncated) continue;
      cursors[candidate.file] = {
        sessionId: parsed.sessionId,
        committedOffset: parsed.completeOffset,
        observedSize: candidate.size,
        mtimeMs: candidate.mtimeMs,
        prefixSha256: parsed.completeSha256,
      };
    }
    if (packets.length === 0) return { scannedFiles: scan.changed.length, warnings };
    const id = sha256(JSON.stringify([MANIFEST_VERSION, projectKey, revision, packets.map((packet) => packet.id)])).slice(0, 32);
    const manifest: EpisodeManifest = {
      version: 1, id, projectKey, corpusRevision: revision,
      createdAt: new Date().toISOString(), packets, cursors,
    };
    await mkdir(workflowDir(root), { recursive: true });
    await atomicWrite(manifestPath(root, id), JSON.stringify(manifest, null, 2));
    return { manifest, scannedFiles: scan.changed.length, warnings };
  } finally { await lock.release(); }
}

/** Commit the cursors recorded by a manifest; only ever moves offsets forward. */
export async function commitManifestCursors(options: { root?: string; env?: NodeJS.ProcessEnv; manifest: EpisodeManifest }): Promise<number> {
  const env = options.env ?? process.env;
  const projectKey = options.manifest.projectKey;
  const manifest = options.manifest;
  const lock = await acquireProjectLock(env, projectKey);
  try {
    await updateProjectState(env, projectKey, (project) => {
      const files = { ...project.files };
      for (const [file, cursor] of Object.entries(manifest.cursors)) {
        const existing = files[file];
        if (existing && existing.committedOffset > cursor.committedOffset) continue;
        files[file] = cursor;
      }
      return { ...project, files };
    });
    return Object.keys(manifest.cursors).length;
  } finally { await lock.release(); }
}

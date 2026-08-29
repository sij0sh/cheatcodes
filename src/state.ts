import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseConceptMarkdown } from "./concept.js";
import { localDir } from "./config.js";

export interface FileCursor {
  sessionId: string;
  committedOffset: number;
  observedSize: number;
  mtimeMs: number;
  prefixSha256: string;
}

export interface ProducerState { version: 1; files: Record<string, FileCursor> }

export interface OperationWrite {
  relativePath: string;
  expected: "absent" | string;
  contentBase64: string;
  intendedSha256: string;
}

export interface MutationOperation {
  version: 1;
  packetId: string;
  sourceFile: string;
  sourceCommittedOffset?: number;
  writes: OperationWrite[];
  terminal: "success" | "no-op" | "schema-invalid";
}

export interface ProjectLock { coalesced: boolean; staleRecovered: boolean; release(): Promise<void> }

export interface LockOptions { coalesce?: boolean }

export const EMPTY_STATE: ProducerState = { version: 1, files: {} };
export const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export async function loadState(root: string): Promise<ProducerState> {
  try {
    const value = JSON.parse(await readFile(path.join(localDir(root), "state.json"), "utf8")) as unknown;
    if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) throw new Error("Unsupported state version");
    const files = (value as { files?: unknown }).files;
    if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("Invalid state.files");
    return value as ProducerState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_STATE);
    throw error;
  }
}

async function atomicWrite(file: string, bytes: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, file);
}

export async function writeState(root: string, state: ProducerState): Promise<void> {
  const ordered: ProducerState = { version: 1, files: Object.fromEntries(Object.entries(state.files).sort(([a], [b]) => a.localeCompare(b))) };
  await atomicWrite(path.join(localDir(root), "state.json"), `${JSON.stringify(ordered, null, 2)}\n`);
}

function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export async function acquireProjectLock(root: string, options: LockOptions = {}): Promise<ProjectLock> {
  const lockFile = path.join(localDir(root), "run.lock");
  await mkdir(path.dirname(lockFile), { recursive: true });
  let staleRecovered = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockFile, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      let released = false;
      return {
        coalesced: false,
        staleRecovered,
        async release() {
          if (released) return;
          released = true;
          await handle.close();
          try {
            const owner = JSON.parse(await readFile(lockFile, "utf8")) as { pid?: number };
            if (owner.pid === process.pid) await rm(lockFile, { force: true });
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let ownerPid = 0;
      try { ownerPid = (JSON.parse(await readFile(lockFile, "utf8")) as { pid?: number }).pid ?? 0; } catch {  }
      if (processAlive(ownerPid)) {
        if (options.coalesce) return { coalesced: true, staleRecovered: false, async release() {  } };
        throw new Error(`Another cheatcodes writer is running (pid ${ownerPid})`);
      }
      await rm(lockFile, { force: true });
      staleRecovered = true;
    }
  }
  throw new Error("Could not acquire project lock");
}

export function operationPath(root: string, packetId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(packetId)) throw new Error("Invalid packet ID");
  return path.join(localDir(root), "operations", `${packetId}.json`);
}

export async function readOperation(root: string, packetId: string): Promise<MutationOperation | undefined> {
  try { return JSON.parse(await readFile(operationPath(root, packetId), "utf8")) as MutationOperation; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function listOperations(root: string): Promise<MutationOperation[]> {
  const directory = path.join(root, ".cheatcodes", "operations");
  let names: string[];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")) as MutationOperation));
}

export async function writeOperation(root: string, operation: MutationOperation): Promise<void> {
  const file = operationPath(root, operation.packetId);
  const existing = await readOperation(root, operation.packetId);
  const rendered = `${JSON.stringify(operation, null, 2)}\n`;
  if (existing) {
    if (`${JSON.stringify(existing, null, 2)}\n` !== rendered) throw new Error(`Operation ${operation.packetId} already exists with different content`);
    return;
  }
  await atomicWrite(file, rendered);
}

function safeTarget(curatedRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) throw new Error("Unsafe operation target");
  const target = path.resolve(curatedRoot, relativePath);
  const relative = path.relative(curatedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Operation target escapes curated concepts");
  return target;
}

async function currentHash(file: string): Promise<string | undefined> {
  try { return sha256(await readFile(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function applyOperation(root: string, operation: MutationOperation): Promise<void> {
  const curated = path.join(root, ".cheatcodes", "curated", "concepts");
  const ids = new Set<string>();
  for (const write of operation.writes) {
    const target = safeTarget(curated, write.relativePath);
    const bytes = Buffer.from(write.contentBase64, "base64");
    if (sha256(bytes) !== write.intendedSha256) throw new Error(`Corrupt intended bytes for ${write.relativePath}`);
    const intended = parseConceptMarkdown(bytes.toString("utf8"));
    const id = path.basename(write.relativePath, ".md");
    if (write.relativePath !== `${id}.md` || intended.frontmatter.cheatcodes_id !== id) throw new Error(`Operation identity mismatch for ${write.relativePath}`);
    if (ids.has(id)) throw new Error(`Duplicate operation target ${id}`);
    ids.add(id);
    const actual = await currentHash(target);
    if (actual === write.intendedSha256) continue;
    if (write.expected === "absent" ? actual !== undefined : actual !== write.expected) throw new Error(`Operation conflict for ${write.relativePath}`);
    if (actual !== undefined) {
      const current = parseConceptMarkdown((await readFile(target)).toString("utf8"));
      if (current.frontmatter.cheatcodes_id !== id || current.frontmatter.type !== intended.frontmatter.type) throw new Error(`Operation target identity or type mismatch for ${write.relativePath}`);
    }
  }
  for (const write of operation.writes) {
    const target = safeTarget(curated, write.relativePath);
    if (await currentHash(target) === write.intendedSha256) continue;
    await atomicWrite(target, Buffer.from(write.contentBase64, "base64"));
  }
}

export async function deleteOperation(root: string, packetId: string): Promise<void> {
  await rm(operationPath(root, packetId), { force: true });
}

export async function fileMetadata(file: string): Promise<{ size: number; mtimeMs: number }> {
  const value = await stat(file);
  return { size: value.size, mtimeMs: value.mtimeMs };
}

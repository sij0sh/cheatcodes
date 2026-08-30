import { createHash } from "node:crypto";
import { open, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface FileCursor {
  sessionId: string;
  committedOffset: number;
  observedSize: number;
  mtimeMs: number;
  prefixSha256: string;
}

export type RunOutcome = "success" | "failed" | "coalesced" | "timeout";

export interface RunRecord {
  version: 1;
  invocationId: string;
  pid: number;
  startedAt: string;
  finishedAt: string;
  outcome: RunOutcome;
  reason?: string;
  changedFiles?: number;
  curatorCalls?: number;
  entriesWritten?: number;
  warnings?: string[];
}

export interface ProjectState {
  files: Record<string, FileCursor>;
  lastRun?: RunRecord;
}

export interface GlobalState {
  version: 1;
  projects: Record<string, ProjectState>;
}

export const EMPTY_PROJECT_STATE: ProjectState = { files: {} };

export const EMPTY_GLOBAL_STATE: GlobalState = { version: 1, projects: {} };

export function globalStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CHEATCODES_STATE?.trim();
  if (override) return path.resolve(override);
  const xdg = env.XDG_STATE_HOME?.trim();
  const base = xdg ? xdg : path.join(homedir(), ".local", "state");
  return path.join(base, "cheatcodes", "state.json");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

let atomicWriteSequence = 0;

export async function atomicWrite(file: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${atomicWriteSequence++}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, file);
}

export function orderState(state: GlobalState): GlobalState {
  const projects: Record<string, ProjectState> = {};
  for (const key of Object.keys(state.projects).sort()) {
    const project = state.projects[key]!;
    const files: Record<string, FileCursor> = {};
    for (const file of Object.keys(project.files).sort()) files[file] = project.files[file]!;
    const ordered: ProjectState = { files };
    if (project.lastRun) ordered.lastRun = project.lastRun;
    projects[key] = ordered;
  }
  return { version: 1, projects };
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function validateCursor(value: unknown, source: string): FileCursor {
  const raw = requireObject(value, `${source} must be an object`);
  for (const field of ["sessionId", "committedOffset", "observedSize", "mtimeMs", "prefixSha256"]) {
    if (!(field in raw)) throw new Error(`${source}.${field} is required`);
  }
  if (typeof raw.sessionId !== "string" || !raw.sessionId) throw new Error(`${source}.sessionId must be a non-empty string`);
  if (typeof raw.prefixSha256 !== "string") throw new Error(`${source}.prefixSha256 must be a string`);
  for (const field of ["committedOffset", "observedSize", "mtimeMs"]) {
    const numeric = raw[field];
    if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric < 0) throw new Error(`${source}.${field} must be a non-negative number`);
  }
  return {
    sessionId: raw.sessionId,
    committedOffset: raw.committedOffset as number,
    observedSize: raw.observedSize as number,
    mtimeMs: raw.mtimeMs as number,
    prefixSha256: raw.prefixSha256,
  };
}

const OUTCOMES = new Set<string>(["success", "failed", "coalesced", "timeout"]);

function validateRunRecord(value: unknown, source: string): RunRecord {
  const raw = requireObject(value, `${source} must be an object`);
  if (raw.version !== 1) throw new Error(`${source}.version must be 1`);
  for (const field of ["invocationId", "startedAt", "finishedAt"]) {
    if (typeof raw[field] !== "string" || !(raw[field] as string)) throw new Error(`${source}.${field} must be a non-empty string`);
  }
  if (typeof raw.pid !== "number" || !Number.isInteger(raw.pid)) throw new Error(`${source}.pid must be an integer`);
  if (typeof raw.outcome !== "string" || !OUTCOMES.has(raw.outcome)) throw new Error(`${source}.outcome must be one of success, failed, coalesced, timeout`);
  const record: RunRecord = {
    version: 1,
    invocationId: raw.invocationId as string,
    pid: raw.pid,
    startedAt: raw.startedAt as string,
    finishedAt: raw.finishedAt as string,
    outcome: raw.outcome as RunOutcome,
  };
  if (raw.reason !== undefined) {
    if (typeof raw.reason !== "string") throw new Error(`${source}.reason must be a string`);
    record.reason = raw.reason;
  }
  for (const field of ["changedFiles", "curatorCalls", "entriesWritten"] as const) {
    if (raw[field] === undefined) continue;
    if (typeof raw[field] !== "number" || !Number.isInteger(raw[field]) || (raw[field] as number) < 0) throw new Error(`${source}.${field} must be a non-negative integer`);
    record[field] = raw[field];
  }
  if (raw.warnings !== undefined) {
    if (!Array.isArray(raw.warnings) || !raw.warnings.every((item) => typeof item === "string")) throw new Error(`${source}.warnings must be a list of strings`);
    record.warnings = raw.warnings;
  }
  return record;
}

export async function loadGlobalState(env: NodeJS.ProcessEnv = process.env): Promise<GlobalState> {
  const file = globalStatePath(env);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_GLOBAL_STATE, projects: {} };
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  const root = requireObject(raw, `${file} must be an object`);
  if (root.version !== 1) throw new Error(`${file}.version must be 1`);
  const projectsRaw = requireObject(root.projects, `${file}.projects must be an object`);
  const projects: Record<string, ProjectState> = {};
  for (const [key, value] of Object.entries(projectsRaw)) {
    const project = requireObject(value, `${file}.projects.${key} must be an object`);
    const filesRaw = requireObject(project.files, `${file}.projects.${key}.files must be an object`);
    const files: Record<string, FileCursor> = {};
    for (const [name, cursor] of Object.entries(filesRaw)) files[name] = validateCursor(cursor, `${file}.projects.${key}.files.${name}`);
    const state: ProjectState = { files };
    if (project.lastRun !== undefined) state.lastRun = validateRunRecord(project.lastRun, `${file}.projects.${key}.lastRun`);
    projects[key] = state;
  }
  return { version: 1, projects };
}

export interface FileLock {
  path: string;
  coalesced: boolean;
  staleRecovered: boolean;
  release(): Promise<void>;
}

function processAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireLock(file: string, options: { coalesce?: boolean; waitMs?: number } = {}): Promise<FileLock> {
  await mkdir(path.dirname(file), { recursive: true });
  let coalesced = false;
  let staleRecovered = false;
  const waitsUntil = options.waitMs ? Date.now() + options.waitMs : 0;
  for (;;) {
    try {
      const handle = await open(file, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (waitsUntil && Date.now() < waitsUntil) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      let ownerPid = 0;
      try {
        ownerPid = (JSON.parse(await readFile(file, "utf8")) as { pid?: unknown }).pid as number ?? 0;
      } catch {
        ownerPid = 0;
      }
      if (!processAlive(ownerPid)) {
        staleRecovered = true;
        await rm(file, { force: true });
        continue;
      }
      if (!options.coalesce) throw new Error(`Another cheatcodes run is active (lock: ${file})`);
      coalesced = true;
      break;
    }
  }
  return {
    path: file,
    coalesced,
    staleRecovered,
    release: async () => { await rm(file, { force: true }); },
  };
}

export function stateLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(globalStatePath(env)), "state.lock");
}

export function projectLockPath(env: NodeJS.ProcessEnv = process.env, projectKey: string): string {
  const safe = projectKey.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(path.dirname(globalStatePath(env)), "locks", `${safe}.lock`);
}

export async function acquireStateLock(env: NodeJS.ProcessEnv = process.env): Promise<FileLock> {
  return acquireLock(stateLockPath(env), { waitMs: 10_000 });
}

export async function acquireProjectLock(env: NodeJS.ProcessEnv, projectKey: string, options: { coalesce?: boolean } = {}): Promise<FileLock> {
  return acquireLock(projectLockPath(env, projectKey), options);
}

export async function updateProjectState(
  env: NodeJS.ProcessEnv,
  projectKey: string,
  mutate: (project: ProjectState) => ProjectState,
): Promise<GlobalState> {
  const lock = await acquireStateLock(env);
  try {
    const state = await loadGlobalState(env);
    const current = state.projects[projectKey] ?? EMPTY_PROJECT_STATE;
    state.projects[projectKey] = mutate(structuredClone(current));
    const ordered = orderState(state);
    await atomicWrite(globalStatePath(env), `${JSON.stringify(ordered, null, 2)}\n`);
    return ordered;
  } finally {
    await lock.release();
  }
}

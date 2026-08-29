import { randomUUID } from "node:crypto";
import { appendFileSync, rmSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  discoverGitRoot, emptyGlobalConfig, initializeProject, loadGlobalConfig, loadProjectIdentity,
  localDir, resolveGlobalInputs, saveGlobalConfig,
} from "./config.js";
import { runProject, type RunOptions, type RunResult } from "./cli.js";
import { acquireProjectLock } from "./state.js";
import type { Curator } from "./curate.js";



export interface LauncherHints {
  launcher?: string;
  launcherVersion?: string;
  sessionFile?: string;
  previousSessionFile?: string;
  model?: string;
  thinking?: string;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function readLauncherHints(env: NodeJS.ProcessEnv = process.env): LauncherHints {
  return {
    launcher: optional(env, "CHEATCODES_LAUNCHER"),
    launcherVersion: optional(env, "CHEATCODES_LAUNCHER_VERSION"),
    sessionFile: optional(env, "CHEATCODES_PI_SESSION_FILE"),
    previousSessionFile: optional(env, "CHEATCODES_PI_PREVIOUS_SESSION_FILE"),
    model: optional(env, "CHEATCODES_PI_MODEL"),
    thinking: optional(env, "CHEATCODES_PI_THINKING"),
  };
}

export function hintModel(hints: LauncherHints): string | undefined {
  if (!hints.model) return undefined;
  return hints.thinking ? `${hints.model}:${hints.thinking}` : hints.model;
}

export function hintInputs(hints: LauncherHints): string[] {
  const directories: string[] = [];
  if (hints.sessionFile) directories.push(path.dirname(hints.sessionFile));
  if (hints.previousSessionFile) directories.push(path.dirname(hints.previousSessionFile));
  return [...new Set(directories)];
}



export type WorkerOutcome = "success" | "failed" | "coalesced" | "skipped" | "timeout";

export interface WorkerRecord {
  version: 1;
  invocationId: string;
  pid: number;
  project?: string;
  projectId?: string;
  startedAt: string;
  finishedAt: string;
  outcome: WorkerOutcome;
  reason?: string;
  changedFiles?: number;
  curatorCalls?: number;
  conceptsWritten?: number;
  warnings?: string[];
}

export async function readLastRun(root: string): Promise<WorkerRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path.join(localDir(root), "last-run.json"), "utf8")) as unknown;
    if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) throw new Error("Unsupported last-run version");
    return value as WorkerRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readWorkerLog(root: string, limit = 50): Promise<WorkerRecord[]> {
  let text: string;
  try { text = await readFile(path.join(localDir(root), "worker.jsonl"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const records: WorkerRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line) as WorkerRecord); } catch {  }
  }
  return records.slice(-limit);
}

const WORKER_LOG_MAX_BYTES = 512 * 1024;
const WORKER_LOG_KEEP = 200;
const MAX_RECORDED_WARNINGS = 20;

async function appendWorkerRecord(root: string, record: WorkerRecord): Promise<void> {
  const file = path.join(localDir(root), "worker.jsonl");
  await mkdir(localDir(root), { recursive: true });
  try {
    const metadata = await stat(file);
    if (metadata.size > WORKER_LOG_MAX_BYTES) {
      const history = await readWorkerLog(root, WORKER_LOG_KEEP);
      const temporary = `${file}.tmp-${process.pid}`;
      await writeFile(temporary, history.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
      await rename(temporary, file);
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeFile(file, `${JSON.stringify(record)}\n`, { flag: "a" });
}

async function writeLastRun(root: string, record: WorkerRecord): Promise<void> {
  const file = path.join(localDir(root), "last-run.json");
  await mkdir(localDir(root), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}



export interface AutoOptions {
  root?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  curator?: Curator;
  curatorFactory?: (model: string) => Promise<Curator>;
  onWarning?: (message: string) => void;
}

export interface AutoResult {
  outcome: WorkerOutcome;
  invocationId: string;
  reason?: string;
  root?: string;
  projectId?: string;
  run?: RunResult;
  warnings?: string[];
}

function recordFor(options: AutoOptions, base: { invocationId: string; startedAt: string; root?: string; projectId?: string }): WorkerRecord {
  return {
    version: 1,
    invocationId: base.invocationId,
    pid: process.pid,
    project: base.root,
    projectId: base.projectId,
    startedAt: base.startedAt,
    finishedAt: (options.now ?? (() => new Date()))().toISOString(),
    outcome: "skipped",
  };
}

export async function runAuto(options: AutoOptions = {}): Promise<AutoResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const invocationId = randomUUID();
  const startedAt = now().toISOString();

  const root = options.root ? path.resolve(options.root) : await discoverGitRoot(options.cwd);
  if (!root) return { outcome: "skipped", invocationId, reason: "outside a Git repository" };

  const base = { invocationId, startedAt, root };
  const hints = readLauncherHints(env);
  let global = await loadGlobalConfig(env);
  if (!global) {
    const model = hintModel(hints);
    if (!model) return { outcome: "failed", invocationId, reason: "no global config exists and no model hint was provided" };
    global = emptyGlobalConfig(model);
    await saveGlobalConfig(global, env);
  }
  if (!global.automation.enabled) return { outcome: "skipped", invocationId, reason: "automation is disabled" };

  let identity = await loadProjectIdentity(root);
  if (!identity) {
    if (!global.automation.setupMissingProjects) return { outcome: "skipped", invocationId, reason: "project is not set up and setupMissingProjects is false" };
    try {
      const initialized = await initializeProject({ root }, env);
      identity = { version: 1, projectId: initialized.projectId };
    } catch (error) {
      const reason = `setup failed: ${(error as Error).message}`;
      try { await writeLastRun(root, { ...recordFor(options, base), outcome: "failed", reason }); } catch {  }
      return { outcome: "failed", invocationId, reason, root };
    }
  }
  const projectId = identity.projectId;

  const warnings: string[] = [];
  const onWarning = (message: string): void => {
    warnings.push(message);
    options.onWarning?.(message);
  };
  const finish = async (outcome: WorkerOutcome, reason?: string, run?: RunResult): Promise<AutoResult> => {
    const record: WorkerRecord = {
      ...recordFor(options, { ...base, projectId }),
      outcome,
      ...(reason ? { reason } : {}),
      ...(run ? { changedFiles: run.changedFiles, curatorCalls: run.curatorCalls, conceptsWritten: run.conceptsWritten } : {}),
      ...(warnings.length ? { warnings: warnings.slice(0, MAX_RECORDED_WARNINGS) } : {}),
    };
    try {
      await writeLastRun(root, record);
      await appendWorkerRecord(root, record);
    } catch {  }
    return { outcome, invocationId, reason, root, projectId, run, warnings };
  };

  const lock = await acquireProjectLock(root, { coalesce: true });
  if (lock.coalesced) return finish("coalesced", "another cheatcodes worker is already running for this project");
  try {
    if (lock.staleRecovered) onWarning("Recovered a stale project mutation lock");
    const deadlineMs = global.workerTimeoutMinutes * 60_000;
    const deadline = now().getTime() + deadlineMs;
    const shouldStop = (): boolean => now().getTime() >= deadline;
    let hardTimer: NodeJS.Timeout | undefined;
    if (!options.curator && !options.curatorFactory) {
      hardTimer = setTimeout(() => {
        try {
          const record: WorkerRecord = { ...recordFor(options, { ...base, projectId }), outcome: "timeout", reason: "worker deadline exceeded" };
          appendFileSync(path.join(localDir(root), "worker.jsonl"), `${JSON.stringify(record)}\n`);
        } catch {  }
        try { rmSync(path.join(localDir(root), "run.lock"), { force: true }); } catch {  }
        process.exit(1);
      }, deadlineMs);
      hardTimer.unref();
    }
    let run: RunResult;
    try {
      run = await runProject({
        root,
        env,
        now,
        onWarning,
        shouldStop,
        extraInputs: hintInputs(hints),
        lock,
        curator: options.curator,
        curatorFactory: options.curatorFactory ? () => options.curatorFactory!(global.model) : undefined,
      });
    } catch (error) {
      return await finish("failed", (error as Error).message);
    } finally {
      if (hardTimer) clearTimeout(hardTimer);
    }
    if (run.deadlineExceeded) return await finish("timeout", "worker deadline exceeded", run);
    return await finish("success", undefined, run);
  } finally {
    await lock.release();
  }
}

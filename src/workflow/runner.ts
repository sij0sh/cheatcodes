import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { maintainProject, type CommitResult } from "../maintain.js";
import { loadCurationState } from "../curation-state.js";
import { buildManifest, commitManifestCursors, readManifest, type EpisodeManifest } from "./manifests.js";

export interface TerminalReport {
  status: "completed" | "parked" | "unknown";
  sessionFile?: string;
}

export interface WorkflowRunResult {
  started: boolean;
  manifestId?: string;
  terminal?: TerminalReport;
  applied?: CommitResult;
  warning?: string;
  warnings: string[];
}

export type PiLauncher = (options: { root: string; target: string }) => Promise<{ exitCode: number }>;

const defaultLauncher: PiLauncher = async ({ root, target }) => {
  const { spawn } = await import("node:child_process");
  // `pi -p` disposes the session when the triggering turn ends, so the engine
  // needs this SDK-backed runner to stay alive across workflow turns.
  const script = path.join(import.meta.dirname ?? ".", "headless.js");
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, target], { cwd: root, stdio: "inherit" });
    child.on("error", () => resolve({ exitCode: 127 }));
    child.on("exit", (code) => resolve({ exitCode: code ?? 1 }));
  });
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The engine stamps every snapshot into its session JSONL. A run counts as
 * terminal success only when the newest choreograph snapshot reports
 * `completed`; parked or missing reports never apply staged work.
 */
export async function findTerminalReport(env: NodeJS.ProcessEnv, root: string, sinceMs: number, manifestId?: string): Promise<TerminalReport> {
  const sessionsRoot = path.join(env.PI_CODING_AGENT_DIR ?? getAgentDir(), "sessions");
  const candidates: { file: string; mtimeMs: number }[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const info = await stat(target).catch(() => undefined);
        if (info && info.mtimeMs >= sinceMs - 1_000) candidates.push({ file: target, mtimeMs: info.mtimeMs });
      }
    }
  };
  await walk(sessionsRoot, 0);
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates.slice(0, 8)) {
    const content = await readFile(candidate.file, "utf8").catch(() => "");
    let cwdMatches = false;
    let status: TerminalReport["status"] = "unknown";
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (!isRecord(parsed)) continue;
      if (!cwdMatches && parsed.type === "session" && typeof parsed.cwd === "string" && path.resolve(parsed.cwd) === root) cwdMatches = true;
      if (parsed.type === "custom" && parsed.customType === "choreograph" && isRecord(parsed.data) && typeof parsed.data.status === "string") {
        // A concurrent workflow in the same project must never satisfy this run's terminal check.
        if (manifestId !== undefined) {
          const execution = isRecord(parsed.data.execution) ? parsed.data.execution : undefined;
          if (parsed.data.workflow !== "cheatcodes-curate" || execution?.target !== manifestId) continue;
        }
        if (parsed.data.status === "parked") status = "parked";
        else if (parsed.data.status === "completed") status = "completed";
        // In-progress snapshots (active, rollover-pending) never satisfy the check.
      }
    }
    if (cwdMatches) return { status, sessionFile: candidate.file };
  }
  return { status: "unknown" };
}

export async function runWorkflowCurator(options: { root?: string; env?: NodeJS.ProcessEnv; launcher?: PiLauncher } = {}): Promise<WorkflowRunResult> {
  const env = options.env ?? process.env;
  const root = path.resolve(options.root ?? process.cwd());
  const warnings: string[] = [];
  const startedAt = Date.now();
  const build = await buildManifest({ root, env });
  warnings.push(...build.warnings);
  if (!build.manifest) return { started: false, warning: "no pending episodes to curate", warnings };
  const manifest: EpisodeManifest = build.manifest;
  const launcher = options.launcher ?? defaultLauncher;
  const launched = await launcher({ root, target: manifest.id });
  if (launched.exitCode === 127) return { started: false, manifestId: manifest.id, warning: "pi CLI is not available; install choreograph and pi to run the curation workflow", warnings };
  const terminal = await findTerminalReport(env, root, startedAt, manifest.id);
  if (terminal.status !== "completed") {
    return { started: true, manifestId: manifest.id, terminal, warning: `workflow did not complete (${terminal.status}); staged work is left pending and cursors are not committed`, warnings };
  }
  const state = await loadCurationState(env, manifest.projectKey);
  if (!state.maintenanceCursor?.pendingTransaction) {
    return { started: true, manifestId: manifest.id, terminal, warning: "workflow completed without staging a transaction", warnings };
  }
  const outcome = await maintainProject({ env, root, mode: "resume" });
  if (outcome.warning) return { started: true, manifestId: manifest.id, terminal, warning: outcome.warning, warnings };
  if (!outcome.committed) return { started: true, manifestId: manifest.id, terminal, warning: "nothing was committed", warnings };
  const committedCursors = await commitManifestCursors({ env, root, manifest });
  warnings.push(`committed ${committedCursors} source cursor(s)`);
  return { started: true, manifestId: manifest.id, terminal, applied: outcome.committed, warnings };
}

export async function loadManifestForReplay(root: string, manifestId: string): Promise<EpisodeManifest | undefined> {
  return await readManifest(root, manifestId);
}

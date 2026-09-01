import path from "node:path";
import { deriveProjectKey, loadGlobalConfig } from "./config.js";
import { checkMapFreshness, runMap, type MapFreshness } from "./map.js";
import { runWorker } from "./run.js";
import { runWorkflowCurator } from "./workflow/runner.js";

export const DEFAULT_ENSURE_TIMEOUT_SECONDS = 120;
// The workflow worker enforces its own workerTimeoutMinutes budget; ensure only
// gates on whether enough budget remains to reasonably start it.
const WORKFLOW_MIN_BUDGET_MS = 60_000;

export interface EnsureContext {
  env: NodeJS.ProcessEnv;
  root: string;
  projectKey: string;
  deadline: number;
}

export interface CurateStage {
  outcome: "success" | "timeout" | "failed" | "coalesced" | "skipped";
  reason?: string;
  changedFiles?: number;
  entriesWritten?: number;
}

export interface WorkflowStage {
  outcome: "completed" | "skipped" | "parked" | "none";
  warning?: string;
  warnings?: string[];
}

export type EnsureMapStatus = "fresh" | "absent" | "synthesized" | "stale (sources changed)" | "stale (inventory changed)" | "failed";
export type EnsureStatus = "refreshed" | "up-to-date" | "timeout" | "locked" | "error";

export interface EnsureResult {
  status: EnsureStatus;
  curated?: { changedFiles: number; entriesWritten: number };
  workflow?: WorkflowStage["outcome"];
  map?: EnsureMapStatus;
  warning?: string;
  warnings: string[];
}

export interface EnsureStages {
  curate?: (context: EnsureContext) => Promise<CurateStage>;
  syncWorkflow?: (context: EnsureContext) => Promise<WorkflowStage>;
  checkMap?: (context: EnsureContext) => Promise<MapFreshness>;
  synthesizeMap?: (context: EnsureContext) => Promise<{ ok: boolean; warning?: string }>;
}

export interface EnsureOptions {
  root?: string;
  timeoutSeconds?: number;
  synthesizeMap?: boolean;
  env?: NodeJS.ProcessEnv;
  stages?: EnsureStages;
}

function defaultCurate(context: EnsureContext): Promise<CurateStage> {
  return runWorker({ env: context.env, root: context.root }).then((result) => ({
    outcome: result.outcome === "success" ? "success" : result.outcome,
    reason: result.reason,
    changedFiles: result.run?.changedFiles,
    entriesWritten: result.run?.entriesWritten,
  }));
}

async function defaultSyncWorkflow(context: EnsureContext): Promise<WorkflowStage> {
  if (Date.now() >= context.deadline - WORKFLOW_MIN_BUDGET_MS) {
    return { outcome: "skipped", warning: "ensure budget exhausted before the workflow step" };
  }
  const result = await runWorkflowCurator({ root: context.root, env: context.env });
  if (!result.started) return { outcome: "none" };
  if (result.terminal?.status !== "completed") return { outcome: "parked", warning: result.warning ?? `workflow ended ${result.terminal?.status ?? "unknown"}`, warnings: result.warnings };
  if (!result.applied) return { outcome: "parked", warning: result.warning ?? "workflow completed without committing", warnings: result.warnings };
  return { outcome: "completed", warnings: result.warnings };
}

function defaultSynthesizeMap(context: EnsureContext): Promise<{ ok: boolean; warning?: string }> {
  return runMap({ root: context.root, env: context.env }).then((result) => ({
    ok: result.status === "committed",
    warning: result.warning,
  }));
}

export function resolveEnsureTimeoutSeconds(env: NodeJS.ProcessEnv, override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) return override;
  const raw = env.CHEATCODES_ENSURE_TIMEOUT?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_ENSURE_TIMEOUT_SECONDS;
}

// One unattended freshness verb: session curation, pending-episode workflow,
// then the free map checks. Model-spending map synthesis happens only when asked.
export async function runEnsure(options: EnsureOptions = {}): Promise<EnsureResult> {
  const env = options.env ?? process.env;
  const root = path.resolve(options.root ?? process.cwd());
  const timeoutSeconds = resolveEnsureTimeoutSeconds(env, options.timeoutSeconds);
  const projectKey = await deriveProjectKey(root);
  const context: EnsureContext & { warnings: string[] } = {
    env,
    root,
    projectKey,
    deadline: Date.now() + timeoutSeconds * 1000,
    warnings: [],
  };
  const stages: Required<EnsureStages> = {
    curate: options.stages?.curate ?? defaultCurate,
    syncWorkflow: options.stages?.syncWorkflow ?? defaultSyncWorkflow,
    checkMap: options.stages?.checkMap ?? ((ctx) => checkMapFreshness(ctx.root, ctx.env)),
    synthesizeMap: options.stages?.synthesizeMap ?? defaultSynthesizeMap,
  };

  const curate = await stages.curate(context);
  if (curate.outcome === "coalesced") {
    return { status: "locked", warning: "another cheatcodes run is active", warnings: context.warnings };
  }
  if (curate.outcome === "failed" || curate.outcome === "skipped") {
    return { status: "error", warning: curate.reason ?? `curation ${curate.outcome}`, warnings: context.warnings };
  }

  const workflow = curate.outcome === "timeout"
    ? { outcome: "skipped" as const, warning: "curation timed out" }
    : await stages.syncWorkflow(context);
  if (workflow.warning) context.warnings.push(workflow.warning);
  for (const warning of workflow.warnings ?? []) if (warning) context.warnings.push(warning);

  let map: EnsureMapStatus | undefined;
  try {
    const freshness = await stages.checkMap(context);
    if (freshness.state === "stale") map = freshness.reason === "sources changed" ? "stale (sources changed)" : "stale (inventory changed)";
    else if (freshness.state === "absent") map = "absent";
    else map = "fresh";
  } catch (error) {
    return { status: "error", warning: `map freshness check failed: ${(error as Error).message}`, warnings: context.warnings };
  }

  const global = await loadGlobalConfig(env).catch(() => undefined);
  const wantsSynthesis = options.synthesizeMap === true || global?.autoMap === true;
  if (map.startsWith("stale") && wantsSynthesis) {
    const synthesis = await stages.synthesizeMap(context);
    if (synthesis.ok) {
      map = "synthesized";
    } else {
      map = "failed";
      context.warnings.push(synthesis.warning ?? "map synthesis failed");
      return { status: "error", map, warning: synthesis.warning ?? "map synthesis failed", warnings: context.warnings };
    }
  }

  const result: EnsureResult = {
    status: "up-to-date",
    workflow: workflow.outcome,
    map,
    warnings: context.warnings,
  };
  if (curate.outcome === "timeout" || workflow.outcome === "skipped") {
    result.status = "timeout";
    if (curate.outcome === "timeout") result.warning = "curation hit its deadline";
  } else if (curate.changedFiles !== undefined) {
    result.curated = { changedFiles: curate.changedFiles, entriesWritten: curate.entriesWritten ?? 0 };
    if (curate.changedFiles > 0 || workflow.outcome === "completed" || map === "synthesized") result.status = "refreshed";
  }
  if (workflow.outcome === "completed") result.status = "refreshed";
  if (map === "synthesized") result.status = "refreshed";
  return result;
}

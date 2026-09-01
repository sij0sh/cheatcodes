import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";
import {
  deriveProjectKey,
  discoverDefaultInputs,
  emptyGlobalConfig,
  ensureKnowledgeOutput,
  globalConfigPath,
  knowledgeFilePath,
  loadGlobalConfig,
  resolveGlobalInputs,
  resolveProjectRoots,
  saveGlobalConfig,
} from "./config.js";
import { applyCuratedEntry, parseKnowledgeDocument, parseKnowledgeMarkdown, removeEntriesFromSessions, renderKnowledgeDocument, type KnowledgeEntry, type KnowledgeRegions } from "./concept.js";
import {
  normalizeCuratorOutcome,
  PiCurator,
  PiQualifier,
  type Curator,
  type CuratedEntry,
} from "./curate.js";
import { createPacket, segmentSession, type EvidenceItem, type HarvestPacket } from "./harvest.js";
import { WORKER_ORIGIN, parseJsonlFile } from "./jsonl.js";
import { recordCurationMetrics, type CurationAgreement, type CuratorMode } from "./metrics.js";
import {
  GATE_IDS,
  QUALIFIER_PROMPT_VERSION,
  qualificationToCurated,
  runStateVeto,
  type QualificationVerdict,
  type Qualifier,
} from "./qualify.js";
import { ensureModelsFile } from "./models.js";
import { scanInputs, type ScanWarning } from "./scan.js";
import {
  acquireProjectLock,
  atomicWrite,
  loadGlobalState,
  updateProjectState,
  type FileLock,
  type ProjectState,
  type RunOutcome,
  type RunRecord,
} from "./state.js";

export interface LauncherHints {
  sessionFile?: string;
  previousSessionFile?: string;
  model?: string;
  thinking?: boolean;
}

export function readLauncherHints(env: NodeJS.ProcessEnv = process.env): LauncherHints {
  return {
    sessionFile: env.CHEATCODES_PI_SESSION_FILE?.trim() ? path.resolve(env.CHEATCODES_PI_SESSION_FILE) : undefined,
    previousSessionFile: env.CHEATCODES_PI_PREVIOUS_SESSION_FILE?.trim() ? path.resolve(env.CHEATCODES_PI_PREVIOUS_SESSION_FILE) : undefined,
    model: env.CHEATCODES_PI_MODEL?.trim() || undefined,
    thinking: env.CHEATCODES_PI_THINKING?.trim() ? true : undefined,
  };
}

export function hintModel(hints: LauncherHints): string | undefined {
  if (!hints.model) return undefined;
  return hints.thinking ? `${hints.model}:thinking` : hints.model;
}

export function hintInputs(hints: LauncherHints): string[] {
  const directories = new Set<string>();
  for (const file of [hints.sessionFile, hints.previousSessionFile]) {
    if (file) directories.add(path.dirname(file));
  }
  return [...directories];
}

export interface RunOptions {
  root?: string;
  cwd?: string;
  curator?: Curator;
  curatorFactory?: () => Promise<Curator>;
  qualifier?: Qualifier;
  qualifierFactory?: () => Promise<Qualifier>;
  now?: () => Date;
  onWarning?: (message: string) => void;
  shouldStop?: () => boolean;
  extraInputs?: string[];
  env?: NodeJS.ProcessEnv;
  lock?: FileLock;
}

export interface RunResult {
  root: string;
  projectKey: string;
  changedFiles: number;
  curatorCalls: number;
  packets: number;
  entriesWritten: number;
  prunedCursors: number;
  unresolvedFiles: number;
  warnings: string[];
  staleLockRecovered: boolean;
  deadlineExceeded: boolean;
  mode: CuratorMode;
}

function warningText(warning: ScanWarning): string { return `${warning.file}: ${warning.message}`; }

export function resolveCuratorMode(env: NodeJS.ProcessEnv): { mode: CuratorMode; warning?: string } {
  const raw = env.CHEATCODES_CURATOR_MODE?.trim().toLowerCase();
  if (!raw || raw === "legacy") return { mode: "legacy" };
  if (raw === "typed" || raw === "shadow") return { mode: raw };
  return { mode: "legacy", warning: `unknown CHEATCODES_CURATOR_MODE "${env.CHEATCODES_CURATOR_MODE}"; using legacy` };
}

async function getCurator(options: RunOptions, root: string, model: string, env: NodeJS.ProcessEnv): Promise<Curator> {
  if (options.curator) return options.curator;
  if (options.curatorFactory) return options.curatorFactory();
  let modelsPath: string | undefined;
  try {
    modelsPath = await ensureModelsFile(env);
  } catch (error) {
    options.onWarning?.(`models registry unavailable, falling back to the Pi default: ${(error as Error).message}`);
  }
  return PiCurator.create({ projectRoot: root, model, modelsPath });
}

async function getQualifier(options: RunOptions, root: string, model: string, env: NodeJS.ProcessEnv): Promise<Qualifier> {
  if (options.qualifier) return options.qualifier;
  if (options.qualifierFactory) return options.qualifierFactory();
  let modelsPath: string | undefined;
  try {
    modelsPath = await ensureModelsFile(env);
  } catch (error) {
    options.onWarning?.(`models registry unavailable, falling back to the Pi default: ${(error as Error).message}`);
  }
  return PiQualifier.create({ projectRoot: root, model, modelsPath });
}

function selectedEvidence(packet: HarvestPacket, entry: CuratedEntry): EvidenceItem[] {
  const selected = new Set(entry.evidenceRefs);
  return packet.evidence.filter((item) => selected.has(item.id));
}

function sourceFor(packet: HarvestPacket, evidence: EvidenceItem[]): string {
  const ids = [...new Set(evidence.flatMap((item) => item.recordIds))].sort();
  return `session:${packet.sessionId}#records=${ids.join(",")}`;
}

function curatedInput(curated: CuratedEntry, source: string, date: string) {
  return {
    action: curated.action,
    targetEntryId: curated.targetEntryId,
    title: curated.title,
    summary: curated.summary,
    body: curated.body,
    date,
    tags: curated.tags,
    sources: [source],
  };
}

export async function runProject(options: RunOptions = {}): Promise<RunResult> {
  const env = options.env ?? process.env;
  const root = path.resolve(options.root ?? options.cwd ?? process.cwd());
  const global = await loadGlobalConfig(env);
  if (!global) throw new Error(`No global config at ${globalConfigPath(env)}`);
  const projectKey = await deriveProjectKey(root);
  const lock = options.lock ?? await acquireProjectLock(env, projectKey);
  const knowledgeFile = knowledgeFilePath(root, global.knowledgeFile);
  const warnings: string[] = [];
  const warn = (message: string): void => { warnings.push(message); options.onWarning?.(message); };
  const curatorMode = resolveCuratorMode(env);
  const mode = curatorMode.mode;
  if (curatorMode.warning) warn(curatorMode.warning);
  let curator: Curator | undefined;
  let qualifier: Qualifier | undefined;
  let curatorCalls = 0;
  let packets = 0;
  let entriesWritten = 0;
  let prunedCursors = 0;
  let unresolvedFiles = 0;
  let deadlineExceeded = false;
  try {
    if (lock.staleRecovered) warn("Recovered a stale project mutation lock");
    await ensureKnowledgeOutput(root, global.knowledgeFile, global.contextPointer !== false);
    const document = parseKnowledgeDocument(await readFile(knowledgeFile, "utf8"));
    let entries: KnowledgeEntry[] = document.entries;
    const regions = document.regions;
    const globalState = await loadGlobalState(env);
    const projectState: ProjectState = globalState.projects[projectKey] ?? { files: {} };
    const inputs = [...resolveGlobalInputs(global, env), ...(options.extraInputs ?? []).map((value) => path.resolve(value))];
    const projectRoots = resolveProjectRoots(global, root, projectKey);
    const scan = await scanInputs(inputs, projectRoots, projectState.files);
    scan.skipped.map(warningText).forEach(warn);
    scan.missing.forEach((file) => warn(`${file}: configured input does not exist`));
    const isolated = removeEntriesFromSessions(entries, scan.foreignSessionIds);
    if (isolated.removed > 0) {
      entries = isolated.entries;
      await renderAndStore(knowledgeFile, regions, entries);
      warn(`Removed ${isolated.removed} knowledge entr${isolated.removed === 1 ? "y" : "ies"} sourced from sessions outside configured project roots`);
    }
    const prunedFiles = new Set<string>();
    const enumerated = new Set([...scan.changed.map((item) => item.file), ...scan.unchanged]);
    for (const file of Object.keys(projectState.files)) {
      if (enumerated.has(file)) continue;
      const underMissing = scan.missing.some((missing) => file === missing || file.startsWith(`${missing}${path.sep}`));
      let exists = false;
      if (!underMissing) {
        try { exists = (await stat(file)).isFile(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      if (underMissing || !exists) {
        prunedFiles.add(file);
        prunedCursors++;
        warn(`Pruned state cursor for removed input: ${file}`);
      }
    }
    if (prunedFiles.size > 0) {
      await updateProjectState(env, projectKey, (project) => {
        const files = { ...project.files };
        for (const file of prunedFiles) delete files[file];
        return { ...project, files };
      });
    }
    for (const candidate of scan.changed) {
      if (options.shouldStop?.()) { deadlineExceeded = true; break; }
      const sessionDate = new Date(candidate.mtimeMs).toISOString();
      const cursor = projectState.files[candidate.file];
      let parsed = await parseJsonlFile(candidate.file, {
        previousCommittedOffset: cursor?.committedOffset ?? 0,
        projectId: projectKey,
        projectRoots,
      });
      const appended = cursor !== undefined && cursor.sessionId === parsed.sessionId && cursor.committedOffset <= parsed.completeOffset && cursor.prefixSha256 === parsed.previousPrefixSha256;
      if (cursor !== undefined && !appended) {
        warn(`${candidate.file}: source was rewritten; all complete records will be reconsidered`);
        parsed = await parseJsonlFile(candidate.file, { previousCommittedOffset: cursor.committedOffset, rewritten: true, projectId: projectKey, projectRoots });
      }
      for (const item of parsed.warnings) warn(`${item.file ?? candidate.file}:${item.range.start}-${item.range.end}: ${item.message}`);
      if (parsed.origin === WORKER_ORIGIN) {
        warn(`${candidate.file}: cheatcodes-worker session excluded from harvest`);
        continue;
      }
      const episodes = segmentSession(parsed);
      let fileUnresolved = false;
      for (const episode of episodes) {
        const packet = createPacket(episode, { projectKey, entries });
        if (!packet) continue;
        packets++;
        const applyEntry = async (curated: CuratedEntry): Promise<boolean> => {
          const veto = runStateVeto(curated.title, curated.summary);
          if (veto) {
            warn(`Entry "${curated.title}" was rejected by the run-state filter (${veto}); no knowledge written`);
            return false;
          }
          const result = applyCuratedEntry(entries, curatedInput(curated, sourceFor(packet, selectedEvidence(packet, curated)), sessionDate), projectKey);
          entries = result.entries;
          if (result.changed) {
            entriesWritten++;
            await renderAndStore(knowledgeFile, regions, entries);
          }
          return result.changed;
        };
        if (mode === "legacy") {
          curator ??= await getCurator(options, root, global.model, env);
          curatorCalls++;
          const outcome = normalizeCuratorOutcome(await curator.curate(packet), packet);
          if (outcome.schemaInvalid || !outcome.response) {
            // Fail closed (guide 0.7): park the file and keep its cursor so the next run retries.
            warn(`Packet ${packet.id} failed schema validation after retries; parking ${candidate.file} until the next run${outcome.warning ? ` : ${outcome.warning}` : ""}`);
            fileUnresolved = true;
            break;
          }
          for (const curated of outcome.response.entries) await applyEntry(curated);
          continue;
        }
        qualifier ??= await getQualifier(options, root, global.model, env);
        curatorCalls++;
        const outcome = await qualifier.qualify(packet);
        const verdictCandidate = outcome.response?.entries[0];
        const verdict: QualificationVerdict | undefined = verdictCandidate?.verdict;
        const gateFailures = verdictCandidate ? GATE_IDS.filter((gate) => verdictCandidate.gateResults[gate] === "fail") : [];
        let wrote = false;
        let legacyWouldWrite: boolean | undefined;
        let agreement: CurationAgreement | undefined;
        if (outcome.schemaInvalid || !outcome.response) {
          warn(`Packet ${packet.id} failed qualification schema validation after ${outcome.schemaRetries} attempt(s)${outcome.warning ? ` : ${outcome.warning}` : ""}`);
        } else if (mode === "typed") {
          for (const accepted of outcome.response.entries.filter((entry) => entry.verdict === "accept")) {
            wrote = (await applyEntry(qualificationToCurated(accepted, packet))) || wrote;
          }
          if (outcome.response.entries.some((entry) => entry.verdict === "needs-review")) {
            warn(`Packet ${packet.id} was marked needs-review; no knowledge written`);
          }
          const rejected = outcome.response.entries.filter((entry) => entry.verdict === "reject");
          if (rejected.length > 0) {
            const reasons = [...new Set(rejected.flatMap((entry) => entry.rejectionReasons))].join(",");
            warn(`Packet ${packet.id} was rejected (${reasons}); no knowledge written`);
          }
        } else {
          curator ??= await getCurator(options, root, global.model, env);
          curatorCalls++;
          const legacy = normalizeCuratorOutcome(await curator.curate(packet), packet);
          legacyWouldWrite = !legacy.schemaInvalid && legacy.response !== undefined && legacy.response.entries.length > 0;
          agreement = legacy.response === undefined
            ? "legacy-error"
            : legacyWouldWrite === (verdict === "accept") ? "agree" : "disagree";
        }
        const recorded = await recordCurationMetrics({
          version: 1,
          at: new Date().toISOString(),
          mode,
          projectKey,
          sessionId: packet.sessionId,
          packetId: packet.id,
          model: global.model,
          promptVersion: QUALIFIER_PROMPT_VERSION,
          ...(verdict ? { verdict } : {}),
          gateFailures,
          rejectionReasons: verdictCandidate?.rejectionReasons ?? [],
          schemaRetries: outcome.schemaRetries,
          latencyMs: outcome.latencyMs,
          ...(outcome.usage?.inputTokens ? { inputTokens: outcome.usage.inputTokens } : {}),
          ...(outcome.usage?.outputTokens ? { outputTokens: outcome.usage.outputTokens } : {}),
          ...(legacyWouldWrite !== undefined ? { legacyWouldWrite } : {}),
          ...(agreement !== undefined ? { agreement } : {}),
          wrote,
        }, env);
        if (!recorded) warn("curation metrics could not be recorded");
        if (mode === "typed" && (outcome.schemaInvalid || !outcome.response)) {
          // Fail closed (guide 0.7): park the file and keep its cursor so the next run retries.
          fileUnresolved = true;
          break;
        }
      }
      if (fileUnresolved) { unresolvedFiles++; continue; }
      projectState.files[candidate.file] = {
        sessionId: parsed.sessionId,
        committedOffset: parsed.completeOffset,
        observedSize: candidate.size,
        mtimeMs: candidate.mtimeMs,
        prefixSha256: parsed.completeSha256,
      };
      const committed = projectState.files[candidate.file]!;
      await updateProjectState(env, projectKey, (project) => ({ ...project, files: { ...project.files, [candidate.file]: committed } }));
    }
    return { root, projectKey, changedFiles: scan.changed.length, curatorCalls, packets, entriesWritten, prunedCursors, unresolvedFiles, warnings, staleLockRecovered: lock.staleRecovered, deadlineExceeded, mode };
  } finally { await lock.release(); }
}

async function renderAndStore(knowledgeFile: string, regions: KnowledgeRegions, entries: KnowledgeEntry[]): Promise<void> {
  await atomicWrite(knowledgeFile, renderKnowledgeDocument({ entries, regions }));
}

export interface ProjectStatus {
  root: string;
  projectKey: string;
  inputs: string[];
  missingInputs: string[];
  discoveredFiles: number;
  entries: number;
  skipped: ScanWarning[];
  knowledgeFile: string;
  lastRun?: RunRecord;
}

export async function projectStatus(root?: string, env: NodeJS.ProcessEnv = process.env): Promise<ProjectStatus> {
  const projectRoot = path.resolve(root ?? process.cwd());
  const global = await loadGlobalConfig(env);
  if (!global) throw new Error(`No global config at ${globalConfigPath(env)}`);
  const projectKey = await deriveProjectKey(projectRoot);
  const inputs = resolveGlobalInputs(global, env);
  const projectRoots = resolveProjectRoots(global, projectRoot, projectKey);
  const projectState = (await loadGlobalState(env)).projects[projectKey] ?? { files: {} };
  const scan = await scanInputs(inputs, projectRoots, projectState.files);
  let entries = 0;
  try {
    entries = parseKnowledgeMarkdown(await readFile(knowledgeFilePath(projectRoot, global.knowledgeFile), "utf8")).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {
    root: projectRoot,
    projectKey,
    inputs,
    missingInputs: scan.missing,
    discoveredFiles: scan.changed.length + scan.unchanged.length,
    entries,
    skipped: scan.skipped,
    knowledgeFile: knowledgeFilePath(projectRoot, global.knowledgeFile),
    lastRun: projectState.lastRun,
  };
}

const MAX_RECORDED_WARNINGS = 20;

export type WorkerOutcome = "success" | "failed" | "coalesced" | "skipped" | "timeout";

export interface WorkerResult {
  outcome: WorkerOutcome;
  invocationId: string;
  root?: string;
  projectKey?: string;
  reason?: string;
  warnings: string[];
  run?: RunResult;
}

function makeRecord(invocationId: string, outcome: RunOutcome, startedAt: Date, finishedAt: Date, extra: Partial<RunRecord> = {}): RunRecord {
  return {
    version: 1,
    invocationId,
    pid: process.pid,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    outcome,
    ...extra,
  };
}

export async function runWorker(options: RunOptions = {}): Promise<WorkerResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const invocationId = randomUUID();
  const startedAt = now();
  const root = path.resolve(options.root ?? options.cwd ?? process.cwd());
  const hints = readLauncherHints(env);
  let global = await loadGlobalConfig(env);
  let configChanged = false;
  if (!global) {
    const model = hintModel(hints);
    if (!model) return { outcome: "skipped", invocationId, reason: `no global config at ${globalConfigPath(env)}`, warnings: [] };
    global = emptyGlobalConfig(model);
    configChanged = true;
  }
  const configuredInputs = new Set(resolveGlobalInputs(global, env));
  const discoveredInputs = (await discoverDefaultInputs(env)).filter((input) => !configuredInputs.has(input));
  if (discoveredInputs.length > 0) {
    global = { ...global, inputs: [...global.inputs, ...discoveredInputs] };
    configChanged = true;
  }
  if (configChanged) await saveGlobalConfig(global, env);
  const projectKey = await deriveProjectKey(root);
  const lock = await acquireProjectLock(env, projectKey, { coalesce: true });
  if (lock.coalesced) {
    await updateProjectState(env, projectKey, (project) => ({ ...project, lastRun: makeRecord(invocationId, "coalesced", startedAt, now()) }));
    return { outcome: "coalesced", invocationId, root, projectKey, warnings: [] };
  }
  const deadlineMs = global.workerTimeoutMinutes * 60_000;
  const deadline = Date.now() + deadlineMs;
  let timer: NodeJS.Timeout | undefined;
  if (!options.curator && !options.curatorFactory) {
    timer = setTimeout(() => {
      rmSync(lock.path, { force: true });
      process.exit(1);
    }, deadlineMs);
  }
  try {
    const run = await runProject({
      ...options,
      root,
      env,
      lock,
      extraInputs: [...(options.extraInputs ?? []), ...hintInputs(hints)],
      shouldStop: options.shouldStop ?? (() => Date.now() >= deadline),
    });
    const finishedAt = now();
    const stats = { changedFiles: run.changedFiles, curatorCalls: run.curatorCalls, entriesWritten: run.entriesWritten, warnings: run.warnings.slice(0, MAX_RECORDED_WARNINGS) };
    if (run.deadlineExceeded) {
      await updateProjectState(env, projectKey, (project) => ({ ...project, lastRun: makeRecord(invocationId, "timeout", startedAt, finishedAt, stats) }));
      return { outcome: "timeout", invocationId, root, projectKey, warnings: run.warnings, run };
    }
    if (run.unresolvedFiles > 0) {
      const reason = `${run.unresolvedFiles} source file(s) parked after unresolved curation; cursors not advanced`;
      await updateProjectState(env, projectKey, (project) => ({ ...project, lastRun: makeRecord(invocationId, "failed", startedAt, finishedAt, { ...stats, reason }) }));
      return { outcome: "failed", invocationId, root, projectKey, reason, warnings: run.warnings, run };
    }
    await updateProjectState(env, projectKey, (project) => ({ ...project, lastRun: makeRecord(invocationId, "success", startedAt, finishedAt, stats) }));
    return { outcome: "success", invocationId, root, projectKey, warnings: run.warnings, run };
  } catch (error) {
    const reason = (error as Error).message;
    try {
      await updateProjectState(env, projectKey, (project) => ({ ...project, lastRun: makeRecord(invocationId, "failed", startedAt, now(), { reason }) }));
    } catch {
      // Recording the failure must not mask the original error.
    }
    return { outcome: "failed", invocationId, root, projectKey, reason, warnings: [] };
  } finally {
    if (timer) clearTimeout(timer);
    await lock.release();
  }
}

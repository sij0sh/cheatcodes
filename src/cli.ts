#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  findProjectRoot, globalConfigPath, initializeProject, loadGlobalConfig, loadProjectIdentity,
  PRODUCER_VERSION, resolveGlobalInputs, resolveProjectRoots,
} from "./config.js";
import { applyAdditiveConceptUpdate, createConceptMarkdown, parseConceptMarkdown, renderConceptMarkdown, type ConceptSource } from "./concept.js";
import { normalizeCuratorOutcome, PiCurator, type Curator, type CuratedConcept } from "./curate.js";
import { createPacket, segmentSession, type ConceptSummary, type EvidenceItem, type HarvestPacket } from "./harvest.js";
import { parseJsonlFile } from "./jsonl.js";
import { publishKnowledge } from "./publish.js";
import { scanInputs, type ScanWarning } from "./scan.js";
import {
  acquireProjectLock, applyOperation, deleteOperation, listOperations, loadState, readOperation, sha256,
  writeOperation, writeState, type MutationOperation, type OperationWrite, type ProjectLock,
} from "./state.js";
import { readLastRun, runAuto, type WorkerRecord } from "./worker.js";

export interface RunOptions {
  root?: string;
  curator?: Curator;
  curatorFactory?: () => Promise<Curator>;
  now?: () => Date;
  onWarning?: (message: string) => void;
  shouldStop?: () => boolean;
  extraInputs?: string[];
  env?: NodeJS.ProcessEnv;
  lock?: ProjectLock;
}

export interface RunResult {
  changedFiles: number;
  curatorCalls: number;
  packets: number;
  conceptsWritten: number;
  prunedCursors: number;
  warnings: string[];
  published: boolean;
  staleLockRecovered: boolean;
  deadlineExceeded: boolean;
}

function warningText(warning: ScanWarning): string { return `${warning.file}: ${warning.message}`; }

async function loadConcepts(root: string): Promise<ConceptSummary[]> {
  const directory = path.join(root, ".cheatcodes", "curated", "concepts");
  let names: string[];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".md")).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const concepts: ConceptSummary[] = [];
  for (const name of names) {
    const markdown = await readFile(path.join(directory, name), "utf8");
    const document = parseConceptMarkdown(markdown);
    concepts.push({
      id: document.frontmatter.cheatcodes_id,
      type: document.frontmatter.type,
      title: document.frontmatter.title,
      description: document.frontmatter.description,
      tags: document.frontmatter.tags,
      status: document.frontmatter.status,
      verified: document.frontmatter.verified,
      content: markdown,
    });
  }
  return concepts;
}

function selectedEvidence(packet: HarvestPacket, concept: CuratedConcept): EvidenceItem[] {
  const selected = new Set(concept.evidenceRefs);
  return packet.evidence.filter((item) => selected.has(item.id));
}

function sourceFor(packet: HarvestPacket, evidence: EvidenceItem[]): ConceptSource {
  const ids = [...new Set(evidence.flatMap((item) => item.recordIds))];
  const digest = sha256(`${packet.sessionId}\0${ids.join("\0")}`).slice(0, 16);
  return { id: `session-${digest}`, resource: `session:${packet.sessionId}#entries=${ids.join(",")}`, title: "Session evidence" };
}

function operationWrite(relativePath: string, expected: "absent" | string, markdown: string): OperationWrite {
  const bytes = Buffer.from(markdown, "utf8");
  return { relativePath, expected, contentBase64: bytes.toString("base64"), intendedSha256: sha256(bytes) };
}

async function operationFromResponse(root: string, sourceFile: string, packet: HarvestPacket, concepts: CuratedConcept[], now: Date, warn: (message: string) => void): Promise<MutationOperation> {
  const writes: OperationWrite[] = [];
  const targetIds = new Set<string>();
  for (const concept of concepts) {
    const evidence = selectedEvidence(packet, concept);
    const source = sourceFor(packet, evidence);
    if (concept.action === "create") {
      const created = createConceptMarkdown({
        type: concept.type,
        title: concept.title,
        description: concept.description,
        tags: concept.tags,
        content: concept.content,
        sources: [source],
        evidence: evidence.map((item) => ({ id: item.id, excerpt: item.excerpt })),
        generatedBy: `cheatcodes/${PRODUCER_VERSION}`,
        generatedAt: now.toISOString(),
      });
      writes.push(operationWrite(`${created.id}.md`, "absent", created.markdown));
      continue;
    }
    const targetId = concept.targetConceptId!;
    if (targetIds.has(targetId)) throw new Error(`Duplicate update target ${targetId}`);
    targetIds.add(targetId);
    const target = path.join(root, ".cheatcodes", "curated", "concepts", `${targetId}.md`);
    let previous: Buffer;
    try { previous = await readFile(target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Update target does not exist: ${targetId}`); throw error; }
    const document = parseConceptMarkdown(previous.toString("utf8"));
    if (document.frontmatter.cheatcodes_id !== targetId) throw new Error(`Update target ID mismatch: ${targetId}`);
    try {
      const result = applyAdditiveConceptUpdate(document, {
        type: concept.type,
        content: concept.content,
        tags: concept.tags,
        sources: [source],
        evidence: evidence.map((item) => ({ id: item.id, excerpt: item.excerpt })),
        generatedAt: now.toISOString(),
      });
      if (result.changed) writes.push(operationWrite(`${targetId}.md`, sha256(previous), renderConceptMarkdown(result.concept)));
    } catch (error) {
      warn(`Packet ${packet.id}: rejected update to ${targetId}: ${(error as Error).message}`);
    }
  }
  return { version: 1, packetId: packet.id, sourceFile, writes, terminal: writes.length ? "success" : "no-op" };
}

async function getCurator(options: RunOptions, root: string, model: string): Promise<Curator> {
  if (options.curator) return options.curator;
  if (options.curatorFactory) return options.curatorFactory();
  return PiCurator.create({ projectRoot: root, model });
}

export async function runProject(options: RunOptions = {}): Promise<RunResult> {
  const env = options.env ?? process.env;
  const root = options.root ? path.resolve(options.root) : await findProjectRoot(undefined, env);
  const identity = await loadProjectIdentity(root);
  if (!identity) throw new Error(`No cheatcodes project at ${root}; run \`cheatcodes init\` first`);
  const global = await loadGlobalConfig(env);
  if (!global) throw new Error(`No global config at ${globalConfigPath(env)}`);
  const inputs = [...resolveGlobalInputs(global, env), ...(options.extraInputs ?? []).map((value) => path.resolve(value))];
  const projectRoots = resolveProjectRoots(global, root, identity.projectId);
  const lock = options.lock ?? await acquireProjectLock(root);
  const warnings: string[] = [];
  const warn = (message: string): void => { warnings.push(message); options.onWarning?.(message); };
  let curator: Curator | undefined;
  let curatorCalls = 0;
  let packets = 0;
  let conceptsWritten = 0;
  let prunedCursors = 0;
  let deadlineExceeded = false;
  try {
    if (lock.staleRecovered) warn("Recovered a stale project mutation lock");
    const state = await loadState(root);
    for (const pending of await listOperations(root)) {
      const committed = state.files[pending.sourceFile]?.committedOffset;
      if (pending.sourceCommittedOffset !== undefined && committed !== undefined && committed >= pending.sourceCommittedOffset) {
        await applyOperation(root, pending);
        await deleteOperation(root, pending.packetId);
      }
    }
    const processedPacketIds = new Set<string>();
    const scan = await scanInputs(inputs, projectRoots, state);
    scan.skipped.map(warningText).forEach(warn);
    scan.missing.forEach((file) => warn(`${file}: configured input does not exist`));
    const enumerated = new Set([...scan.changed.map((item) => item.file), ...scan.unchanged]);
    for (const file of Object.keys(state.files)) {
      if (enumerated.has(file)) continue;
      const underMissing = scan.missing.some((missing) => file === missing || file.startsWith(`${missing}${path.sep}`));
      let exists = false;
      if (!underMissing) {
        try { exists = (await stat(file)).isFile(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      if (underMissing || !exists) {
        delete state.files[file];
        prunedCursors++;
        warn(`Pruned state cursor for removed input: ${file}`);
      }
    }
    if (prunedCursors) await writeState(root, state);
    for (const candidate of scan.changed) {
      if (options.shouldStop?.()) { deadlineExceeded = true; break; }
      const cursor = state.files[candidate.file];
      let parsed = await parseJsonlFile(candidate.file, {
        previousCommittedOffset: cursor?.committedOffset ?? 0,
        projectId: identity.projectId,
        projectRoots,
      });
      const appended = cursor !== undefined && cursor.sessionId === parsed.sessionId && cursor.committedOffset <= parsed.completeOffset && cursor.prefixSha256 === parsed.previousPrefixSha256;
      const rewritten = cursor !== undefined && !appended;
      if (rewritten) {
        warn(`${candidate.file}: source was rewritten; all complete records will be reconsidered`);
        parsed = await parseJsonlFile(candidate.file, { previousCommittedOffset: cursor.committedOffset, rewritten: true, projectId: identity.projectId, projectRoots });
      }
      for (const item of parsed.warnings) warn(`${item.file ?? candidate.file}:${item.range.start}-${item.range.end}: ${item.message}`);
      const completedOperations: string[] = [];
      const episodes = segmentSession(parsed);
      for (const episode of episodes) {
        const packet = createPacket(episode, { projectId: identity.projectId, concepts: await loadConcepts(root) });
        if (!packet) continue;
        packets++;
        if (processedPacketIds.has(packet.id)) continue;
        processedPacketIds.add(packet.id);
        let operation = await readOperation(root, packet.id);
        if (!operation) {
          curator ??= await getCurator(options, root, global.model);
          curatorCalls++;
          const outcome = normalizeCuratorOutcome(await curator.curate(packet), packet);
          if (outcome.schemaInvalid || !outcome.response) {
            warn(`Packet ${packet.id} was terminally skipped after schema validation failed${outcome.warning ? `: ${outcome.warning}` : ""}`);
            operation = { version: 1, packetId: packet.id, sourceFile: candidate.file, writes: [], terminal: "schema-invalid" };
          } else {
            operation = await operationFromResponse(root, candidate.file, packet, outcome.response.concepts, (options.now ?? (() => new Date()))(), warn);
          }
          operation.sourceCommittedOffset = parsed.completeOffset;
          await writeOperation(root, operation);
        }
        if (operation.sourceFile !== candidate.file) throw new Error(`Operation ${operation.packetId} belongs to another source file`);
        await applyOperation(root, operation);
        conceptsWritten += operation.writes.length;
        completedOperations.push(operation.packetId);
      }
      state.files[candidate.file] = {
        sessionId: parsed.sessionId,
        committedOffset: parsed.completeOffset,
        observedSize: candidate.size,
        mtimeMs: candidate.mtimeMs,
        prefixSha256: parsed.completeSha256,
      };
      await writeState(root, state);
      for (const packetId of completedOperations) await deleteOperation(root, packetId);
    }
    const published = await publishKnowledge(root);
    return { changedFiles: scan.changed.length, curatorCalls, packets, conceptsWritten, prunedCursors, warnings, published: published.changed, staleLockRecovered: lock.staleRecovered, deadlineExceeded };
  } finally { await lock.release(); }
}

export async function publishProject(root?: string): Promise<Awaited<ReturnType<typeof publishKnowledge>>> {
  const projectRoot = root ? path.resolve(root) : await findProjectRoot();
  const lock = await acquireProjectLock(projectRoot);
  try { return await publishKnowledge(projectRoot); } finally { await lock.release(); }
}

export interface ProjectStatus {
  root: string;
  projectId: string;
  inputs: string[];
  missingInputs: string[];
  discoveredFiles: number;
  drafts: number;
  stable: number;
  deprecated: number;
  skipped: ScanWarning[];
  lastRun?: WorkerRecord;
}

export async function projectStatus(root?: string, env: NodeJS.ProcessEnv = process.env): Promise<ProjectStatus> {
  const projectRoot = root ? path.resolve(root) : await findProjectRoot(undefined, env);
  const identity = await loadProjectIdentity(projectRoot);
  if (!identity) throw new Error(`No cheatcodes project at ${projectRoot}`);
  const global = await loadGlobalConfig(env);
  if (!global) throw new Error(`No global config at ${globalConfigPath(env)}`);
  const inputs = resolveGlobalInputs(global, env);
  const projectRoots = resolveProjectRoots(global, projectRoot, identity.projectId);
  const concepts = await loadConcepts(projectRoot);
  const scan = await scanInputs(inputs, projectRoots, await loadState(projectRoot));
  return {
    root: projectRoot,
    projectId: identity.projectId,
    inputs,
    missingInputs: scan.missing,
    discoveredFiles: scan.changed.length + scan.unchanged.length,
    drafts: concepts.filter((item) => item.status === "draft").length,
    stable: concepts.filter((item) => item.status === "stable").length,
    deprecated: concepts.filter((item) => item.status === "deprecated").length,
    skipped: scan.skipped,
    lastRun: await readLastRun(projectRoot),
  };
}

function usage(): string {
  return "Usage:\n  cheatcodes init\n  cheatcodes run\n  cheatcodes publish\n  cheatcodes status\n  cheatcodes auto";
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    if (!command) process.exitCode = 2;
    return;
  }
  if (rest.length > 0) {
    console.error(`cheatcodes ${command} takes no options or arguments`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (command === "init") {
    const result = await initializeProject();
    console.log(`Initialized cheatcodes project ${result.projectId} in ${result.root}`);
  } else if (command === "run") {
    const result = await runProject();
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
    console.log(`Processed ${result.changedFiles} changed file(s), ${result.curatorCalls} curator call(s), ${result.conceptsWritten} concept write(s).`);
  } else if (command === "publish") {
    const result = await publishProject();
    console.log(result.changed ? `Published ${result.conceptCount} concept(s).` : "Knowledge bundle is up to date.");
  } else if (command === "status") {
    const result = await projectStatus();
    console.log(`Project ${result.projectId} at ${result.root}`);
    console.log(`Inputs: ${result.discoveredFiles} session file(s) discovered, ${result.skipped.length} skipped, ${result.missingInputs.length} missing input(s).`);
    console.log(`Concepts: ${result.drafts} draft, ${result.stable} stable, ${result.deprecated} deprecated.`);
    if (result.lastRun) {
      console.log(`Last worker run: ${result.lastRun.outcome}${result.lastRun.reason ? ` (${result.lastRun.reason})` : ""} at ${result.lastRun.finishedAt}.`);
    } else {
      console.log("Last worker run: none recorded.");
    }
  } else if (command === "auto") {
    const result = await runAuto();
    if (result.outcome === "failed" || result.outcome === "timeout") {
      console.error(`cheatcodes auto: ${result.outcome}${result.reason ? `: ${result.reason}` : ""}`);
      process.exitCode = 1;
      return;
    }
    console.log(`cheatcodes auto: ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`);
  } else {
    console.error(`cheatcodes: unknown command "${command}"`);
    console.error(usage());
    process.exitCode = 2;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) main().catch((error) => { console.error(`cheatcodes: ${(error as Error).message}`); process.exitCode = 1; });

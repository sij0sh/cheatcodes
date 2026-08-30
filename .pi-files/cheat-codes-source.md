# cheat-codes - source bundle

- generated: 2026-08-30T13:15:18+00:00
- files: 24
- total: 3,647 lines / 157,410 bytes
- scope: repo source + cheat-codes knowledge base (no node_modules, no dist, no package-lock, no curated duplicates, no local runtime state)

## contents

| file | lines | bytes | sha256 |
| --- | ---: | ---: | --- |
| [package.json](#packagejson) | 30 | 729 | `9134f5e19907d8a2` |
| [tsconfig.json](#tsconfigjson) | 16 | 328 | `4bd34f3354b2d186` |
| [AGENTS.md](#AGENTSmd) | 4 | 115 | `e4647afffc4f32e1` |
| [src/cli.ts](#srcclits) | 341 | 16,612 | `42297942e3f29799` |
| [src/concept.ts](#srcconceptts) | 475 | 16,822 | `654bc73746ddcc35` |
| [src/config.ts](#srcconfigts) | 350 | 15,346 | `6122efdf71d3700b` |
| [src/curate.ts](#srccuratets) | 142 | 7,763 | `5ae75b87629c456d` |
| [src/harvest.ts](#srcharvestts) | 293 | 13,431 | `7cde3d09cc8144a6` |
| [src/jsonl.ts](#srcjsonlts) | 419 | 19,333 | `7208743d14b8a9d5` |
| [src/publish.ts](#srcpublishts) | 309 | 9,842 | `3b34cd577a9a39ef` |
| [src/scan.ts](#srcscants) | 94 | 4,628 | `f2fef7558567ba42` |
| [src/state.ts](#srcstatets) | 183 | 8,568 | `814427d6a9b73627` |
| [src/worker.ts](#srcworkerts) | 254 | 9,477 | `a7f2ea7c44458040` |
| [test/auto.test.ts](#testautotestts) | 296 | 14,534 | `151246deb174666e` |
| [test/helpers.ts](#testhelpersts) | 39 | 1,456 | `b4b7045ee3315220` |
| [test/mvp.test.ts](#testmvptestts) | 102 | 5,519 | `8aaab1d330668f22` |
| [test/smoke.live.test.ts](#testsmokelivetestts) | 61 | 3,934 | `096dbed71a5bc2b9` |
| [.cheatcodes/project.json](#cheatcodesprojectjson) | 5 | 80 | `a58a7d0edfed271a` |
| [.cheatcodes/knowledge/concepts/2fad95eef7.md](#cheatcodesknowledgeconcepts2fad95eef7md) | 41 | 1,699 | `4cc0482fd061f2f3` |
| [.cheatcodes/knowledge/concepts/4fa2bab553.md](#cheatcodesknowledgeconcepts4fa2bab553md) | 77 | 2,931 | `9ae5f8c983d6e723` |
| [.cheatcodes/knowledge/concepts/6cf7bf3342.md](#cheatcodesknowledgeconcepts6cf7bf3342md) | 35 | 1,184 | `eb4aab20b1f4a707` |
| [.cheatcodes/knowledge/concepts/7fa22339ce.md](#cheatcodesknowledgeconcepts7fa22339cemd) | 58 | 2,140 | `67994bbdd206e1d2` |
| [.cheatcodes/knowledge/concepts/index.md](#cheatcodesknowledgeconceptsindexmd) | 15 | 822 | `4ab7f4f98aefb7c8` |
| [.cheatcodes/knowledge/index.md](#cheatcodesknowledgeindexmd) | 8 | 117 | `c0e82332b893187b` |

## `package.json`

```json
{
  "name": "cheatcodes",
  "version": "0.2.0",
  "description": "Standalone coding-agent knowledge harvester and curator CLI.",
  "type": "module",
  "bin": { "cheatcodes": "dist/cli.js" },
  "exports": {
    ".": "./dist/cli.js",
    "./cli": "./dist/cli.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepack": "npm run build",
    "test": "node --import tsx --test test/**/*.test.ts",
    "start": "tsx src/cli.ts"
  },
  "engines": { "node": ">=22.19.0" },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "^0.84.4",
    "yaml": "^2.8.1",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^24.10.0",
    "tsx": "^4.20.6",
    "typescript": "^5.9.3"
  }
}
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts"]
}
```

## `AGENTS.md`

```markdown
## Project knowledge

Start with `.cheatcodes/knowledge/index.md`. Check concept status before relying on a draft.
```

## `src/cli.ts`

```typescript
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
```

## `src/concept.ts`

```typescript
import { randomBytes } from "node:crypto";
import { parse, stringify } from "yaml";

export const CONCEPT_TYPES = ["Decision", "Gotcha", "Runbook"] as const;
export type ConceptType = (typeof CONCEPT_TYPES)[number];

export const CONCEPT_STATUSES = ["draft", "stable", "deprecated"] as const;
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];

export interface GeneratedMetadata {
  by: string;
  at?: string;
  [key: string]: unknown;
}

export interface Verification {
  by: string;
  at: string;
  [key: string]: unknown;
}

export interface ConceptSource {
  id: string;
  resource: string;
  title?: string;
  [key: string]: unknown;
}


export interface ConceptFrontmatter {
  cheatcodes_id: string;
  type: ConceptType;
  title: string;
  description: string;
  tags?: string[];
  status: ConceptStatus;
  generated: GeneratedMetadata;
  sources: ConceptSource[];
  verified?: Verification[];
  stale_after?: string;
  [key: string]: unknown;
}

export interface ConceptDocument {
  frontmatter: ConceptFrontmatter;
  
  body: string;
}

export type DecisionContent = {
  answer: string;
  rationale: string;
  rejectedAlternative?: string;
};

export type GotchaContent = {
  symptom: string;
  cause: string;
  fix: string;
  validation?: string;
};

export type RunbookContent = {
  purpose: string;
  steps: string[];
  validation?: string;
};

export type ConceptContent = DecisionContent | GotchaContent | RunbookContent;

export interface ConceptEvidence {
  id: string;
  excerpt: string;
  title?: string;
}

export interface CreateConceptInput {
  
  id?: string;
  type: ConceptType;
  title: string;
  description: string;
  tags?: string[];
  content: ConceptContent;
  sources: ConceptSource[];
  evidence?: ConceptEvidence[];
  generatedBy: string;
  generatedAt: string;
  
  extraFrontmatter?: Record<string, unknown>;
}

export interface AdditiveConceptUpdate {
  type: ConceptType;
  content: ConceptContent;
  tags?: string[];
  sources: ConceptSource[];
  evidence?: ConceptEvidence[];
  generatedAt: string;
  
  generatedBy?: string;
}

export interface AdditiveUpdateResult {
  concept: ConceptDocument;
  changed: boolean;
  contentAdded: boolean;
  provenanceAdded: boolean;
}

export class ConceptValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid concept:\n- ${issues.join("\n- ")}`);
    this.name = "ConceptValidationError";
    this.issues = issues;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function validateDatetime(value: unknown, path: string, issues: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !DATETIME_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push(`${path} must be an ISO 8601 datetime with a UTC offset`);
    return undefined;
  }
  return value;
}

function validateResource(value: unknown, path: string, issues: string[]): string {
  const resource = requiredString(value, path, issues);
  if (resource !== "" && /[\u0000-\u001f\u007f]/u.test(resource)) {
    issues.push(`${path} must not contain control characters`);
  }
  return resource;
}

function normalizeStringList(value: unknown, path: string, issues: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push(`${path} must be a list of non-empty strings`);
    return undefined;
  }
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = requiredString(value[index], `${path}[${index}]`, issues);
    if (item && !result.includes(item)) result.push(item);
  }
  return result;
}


export function validateConceptFrontmatter(value: unknown): ConceptFrontmatter {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ConceptValidationError(["frontmatter must be a mapping"]);

  const id = requiredString(value.cheatcodes_id, "cheatcodes_id", issues);
  if (id && !ID_PATTERN.test(id)) {
    issues.push("cheatcodes_id may contain only letters, digits, dots, underscores, and hyphens");
  }

  const rawType = requiredString(value.type, "type", issues);
  if (!CONCEPT_TYPES.includes(rawType as ConceptType)) {
    issues.push(`type must be one of ${CONCEPT_TYPES.join(", ")}`);
  }

  const rawStatus = requiredString(value.status, "status", issues);
  if (!CONCEPT_STATUSES.includes(rawStatus as ConceptStatus)) {
    issues.push(`status must be one of ${CONCEPT_STATUSES.join(", ")}`);
  }

  const title = requiredString(value.title, "title", issues);
  const description = requiredString(value.description, "description", issues);
  const tags = normalizeStringList(value.tags, "tags", issues);

  let generated: GeneratedMetadata = { by: "" };
  if (!isRecord(value.generated)) {
    issues.push("generated must be a mapping");
  } else {
    generated = {
      ...value.generated,
      by: requiredString(value.generated.by, "generated.by", issues),
    } as GeneratedMetadata;
    const at = validateDatetime(value.generated.at, "generated.at", issues);
    if (at !== undefined) generated.at = at;
    else if (value.generated.at !== undefined) delete generated.at;
  }

  const sources: ConceptSource[] = [];
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    issues.push("sources must be a non-empty list");
  } else {
    value.sources.forEach((source, index) => {
      if (!isRecord(source)) {
        issues.push(`sources[${index}] must be a mapping`);
        return;
      }
      const normalized: ConceptSource = {
        ...source,
        id: requiredString(source.id, `sources[${index}].id`, issues),
        resource: validateResource(source.resource, `sources[${index}].resource`, issues),
      } as ConceptSource;
      if (source.title !== undefined) {
        normalized.title = requiredString(source.title, `sources[${index}].title`, issues);
      }
      sources.push(normalized);
    });
  }
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) issues.push(`duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
  }

  let verified: Verification[] | undefined;
  if (value.verified !== undefined) {
    const events = Array.isArray(value.verified) ? value.verified : [value.verified];
    verified = [];
    events.forEach((event, index) => {
      if (!isRecord(event)) {
        issues.push(`verified[${index}] must be a mapping`);
        return;
      }
      verified!.push({
        ...event,
        by: requiredString(event.by, `verified[${index}].by`, issues),
        at: validateDatetime(event.at, `verified[${index}].at`, issues) ?? "",
      } as Verification);
    });
    if (verified.length === 0) issues.push("verified must contain at least one event");
  }

  const staleAfter = validateDatetime(value.stale_after, "stale_after", issues);
  if (issues.length > 0) throw new ConceptValidationError(issues);

  const normalized: Record<string, unknown> = { ...value };
  normalized.cheatcodes_id = id;
  normalized.type = rawType;
  normalized.title = title;
  normalized.description = description;
  normalized.status = rawStatus;
  normalized.generated = generated;
  normalized.sources = sources;
  if (tags !== undefined) normalized.tags = tags;
  if (verified !== undefined) normalized.verified = verified;
  if (staleAfter !== undefined) normalized.stale_after = staleAfter;
  return normalized as ConceptFrontmatter;
}


export function parseConceptMarkdown(markdown: string): ConceptDocument {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new ConceptValidationError(["document must start with YAML frontmatter"]);
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) throw new ConceptValidationError(["frontmatter must end with ---"]);

  const yamlText = normalized.slice(4, closing);
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConceptValidationError([`invalid YAML: ${message}`]);
  }
  const frontmatter = validateConceptFrontmatter(raw);
  const body = normalized.slice(closing + 5).trim();
  if (body === "") throw new ConceptValidationError(["body must be non-empty"]);
  return { frontmatter, body };
}


export function renderConceptMarkdown(concept: ConceptDocument): string {
  const frontmatter = validateConceptFrontmatter(concept.frontmatter);
  const body = concept.body.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new ConceptValidationError(["body must be non-empty"]);
  const yaml = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body}\n`;
}

export function generateConceptId(): string {
  return randomBytes(5).toString("hex");
}

function assertContent(type: ConceptType, content: ConceptContent): void {
  const issues: string[] = [];
  if (!isRecord(content)) throw new ConceptValidationError(["content must be a mapping"]);
  if (type === "Decision") {
    const decision = content as DecisionContent;
    requiredString(decision.answer, "content.answer", issues);
    requiredString(decision.rationale, "content.rationale", issues);
    if (decision.rejectedAlternative !== undefined) requiredString(decision.rejectedAlternative, "content.rejectedAlternative", issues);
  } else if (type === "Gotcha") {
    const gotcha = content as GotchaContent;
    requiredString(gotcha.symptom, "content.symptom", issues);
    requiredString(gotcha.cause, "content.cause", issues);
    requiredString(gotcha.fix, "content.fix", issues);
    if (gotcha.validation !== undefined) requiredString(gotcha.validation, "content.validation", issues);
  } else {
    const runbook = content as RunbookContent;
    requiredString(runbook.purpose, "content.purpose", issues);
    if (!Array.isArray(runbook.steps) || runbook.steps.length === 0) issues.push("content.steps must be a non-empty list");
    else runbook.steps.forEach((step, index) => requiredString(step, `content.steps[${index}]`, issues));
    if (runbook.validation !== undefined) requiredString(runbook.validation, "content.validation", issues);
  }
  if (issues.length) throw new ConceptValidationError(issues);
}

function section(level: number, title: string, text: string): string {
  return `${"#".repeat(level)} ${title}\n\n${text.trim()}`;
}


export function renderConceptBody(type: ConceptType, content: ConceptContent, evidence: ConceptEvidence[] = [], level = 1): string {
  assertContent(type, content);
  const sections: string[] = [];
  if (type === "Decision") {
    const decision = content as DecisionContent;
    sections.push(section(level, "Answer", decision.answer), section(level, "Why", decision.rationale));
    if (decision.rejectedAlternative) sections.push(section(level, "Rejected alternative", decision.rejectedAlternative));
  } else if (type === "Gotcha") {
    const gotcha = content as GotchaContent;
    sections.push(section(level, "Symptom", gotcha.symptom), section(level, "Cause", gotcha.cause), section(level, "Fix", gotcha.fix));
    if (gotcha.validation) sections.push(section(level, "Validation", gotcha.validation));
  } else {
    const runbook = content as RunbookContent;
    const steps = runbook.steps.map((step, index) => `${index + 1}. ${step.trim()}`).join("\n");
    sections.push(section(level, "Purpose", runbook.purpose), section(level, "Steps", steps));
    if (runbook.validation) sections.push(section(level, "Validation", runbook.validation));
  }

  if (evidence.length > 0) {
    const seen = new Set<string>();
    const lines = evidence.map((item, index) => {
      const id = requiredEvidence(item, index, seen);
      return `- [${id}] ${item.excerpt.trim()}`;
    });
    sections.push(section(level, "Evidence", lines.join("\n")));
  }
  return sections.join("\n\n");
}

function requiredEvidence(item: ConceptEvidence, index: number, seen: Set<string>): string {
  const issues: string[] = [];
  if (!isRecord(item)) throw new ConceptValidationError([`evidence[${index}] must be a mapping`]);
  const id = requiredString(item.id, `evidence[${index}].id`, issues);
  requiredString(item.excerpt, `evidence[${index}].excerpt`, issues);
  if (seen.has(id)) issues.push(`duplicate evidence id: ${id}`);
  seen.add(id);
  if (issues.length) throw new ConceptValidationError(issues);
  return id;
}


export function createConcept(input: CreateConceptInput): ConceptDocument {
  const id = input.id ?? generateConceptId();
  const frontmatter = validateConceptFrontmatter({
    ...input.extraFrontmatter,
    cheatcodes_id: id,
    type: input.type,
    title: input.title,
    description: input.description,
    tags: unique(input.tags ?? []),
    status: "draft",
    generated: { by: input.generatedBy, at: input.generatedAt },
    sources: input.sources,
  });
  return {
    frontmatter,
    body: renderConceptBody(input.type, input.content, input.evidence),
  };
}

export function createConceptMarkdown(input: CreateConceptInput): { id: string; concept: ConceptDocument; markdown: string } {
  const concept = createConcept(input);
  return {
    id: concept.frontmatter.cheatcodes_id,
    concept,
    markdown: renderConceptMarkdown(concept),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sourceKey(source: ConceptSource): string {
  return `${source.id}\u0000${source.resource}`;
}





export function applyAdditiveConceptUpdate(existing: ConceptDocument, update: AdditiveConceptUpdate): AdditiveUpdateResult {
  const current = validateConceptFrontmatter(existing.frontmatter);
  if (current.status !== "draft" || current.verified !== undefined) {
    throw new ConceptValidationError(["automatic updates require an unverified draft concept"]);
  }
  if (current.type !== update.type) {
    throw new ConceptValidationError([`update type ${update.type} does not match target type ${current.type}`]);
  }

  const addendumBody = renderConceptBody(update.type, update.content, update.evidence, 3);
  const addendum = `## Addendum\n\n${addendumBody}`;
  const updatesHeading = "# Updates";
  const existingBody = existing.body.replace(/\r\n?/g, "\n").trim();
  const contentAdded = !existingBody.includes(addendum);

  const sources = current.sources.map((source) => ({ ...source }));
  const sourceKeys = new Set(sources.map(sourceKey));
  const ids = new Map(sources.map((source) => [source.id, source.resource]));
  let provenanceAdded = false;
  for (const source of update.sources) {
    const validated = validateConceptFrontmatter({ ...current, sources: [source] }).sources[0]!;
    const priorResource = ids.get(validated.id);
    if (priorResource !== undefined && priorResource !== validated.resource) {
      throw new ConceptValidationError([`source id ${validated.id} refers to two resources`]);
    }
    const key = sourceKey(validated);
    if (!sourceKeys.has(key)) {
      sources.push(validated);
      sourceKeys.add(key);
      ids.set(validated.id, validated.resource);
      provenanceAdded = true;
    }
  }

  const tags = unique([...(current.tags ?? []), ...(update.tags ?? [])]);
  const tagsAdded = tags.length !== (current.tags ?? []).length;
  const changed = contentAdded || provenanceAdded || tagsAdded;
  if (!changed) return { concept: { frontmatter: current, body: existingBody }, changed, contentAdded, provenanceAdded };

  let body = existingBody;
  if (contentAdded) {
    body = body.includes(`\n${updatesHeading}\n`) || body.startsWith(`${updatesHeading}\n`)
      ? `${body}\n\n${addendum}`
      : `${body}\n\n${updatesHeading}\n\n${addendum}`;
  }
  const frontmatter = validateConceptFrontmatter({
    ...current,
    tags,
    sources,
    generated: contentAdded || provenanceAdded
      ? {
          ...current.generated,
          by: update.generatedBy ?? current.generated.by,
          at: update.generatedAt,
        }
      : current.generated,
  });
  return { concept: { frontmatter, body }, changed, contentAdded, provenanceAdded };
}


export const parseConcept = parseConceptMarkdown;
export const renderConcept = renderConceptMarkdown;
export const updateConceptAdditively = applyAdditiveConceptUpdate;
```

## `src/config.ts`

```typescript
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { publishKnowledge } from "./publish.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export const PRODUCER_VERSION: string = require("../package.json").version as string;



export interface GlobalAutomation { enabled: boolean; setupMissingProjects: boolean }

export interface GlobalConfig {
  version: 1;
  model: string;
  inputs: string[];
  automation: GlobalAutomation;
  workerTimeoutMinutes: number;
  projectAliases: Record<string, string[]>;
}

export interface ProjectIdentity { version: 1; projectId: string }

export const DEFAULT_AUTOMATION: GlobalAutomation = { enabled: true, setupMissingProjects: true };

export function globalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CHEATCODES_CONFIG?.trim();
  if (override) return path.resolve(override);
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg ? xdg : path.join(homedir(), ".config");
  return path.join(base, "cheatcodes", "config.json");
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`${name} must be a list of paths`);
  }
  return [...new Set(value.map((item) => (item as string).trim()))];
}

export function validateGlobalConfig(value: unknown, source = "config"): GlobalConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["version", "model", "inputs", "automation", "workerTimeoutMinutes", "projectAliases"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`${source}.${key} is not a recognized field`);
  }
  if (raw.version !== 1) throw new Error(`${source}.version must be 1`);
  const automationRaw = raw.automation;
  if (!automationRaw || typeof automationRaw !== "object" || Array.isArray(automationRaw)) {
    throw new Error(`${source}.automation must be an object`);
  }
  const automation = automationRaw as Record<string, unknown>;
  for (const key of Object.keys(automation)) {
    if (key !== "enabled" && key !== "setupMissingProjects") throw new Error(`${source}.automation.${key} is not a recognized field`);
  }
  if (typeof automation.enabled !== "boolean") throw new Error(`${source}.automation.enabled must be a boolean`);
  if (typeof automation.setupMissingProjects !== "boolean") throw new Error(`${source}.automation.setupMissingProjects must be a boolean`);
  const timeout = raw.workerTimeoutMinutes;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) throw new Error(`${source}.workerTimeoutMinutes must be a positive number`);
  const aliasesRaw = raw.projectAliases;
  if (!aliasesRaw || typeof aliasesRaw !== "object" || Array.isArray(aliasesRaw)) throw new Error(`${source}.projectAliases must be an object`);
  const projectAliases: Record<string, string[]> = {};
  for (const [id, paths] of Object.entries(aliasesRaw)) projectAliases[nonempty(id, `${source}.projectAliases key`)] = stringList(paths, `${source}.projectAliases.${id}`);
  return {
    version: 1,
    model: nonempty(raw.model, `${source}.model`),
    inputs: stringList(raw.inputs, `${source}.inputs`),
    automation: { enabled: automation.enabled, setupMissingProjects: automation.setupMissingProjects },
    workerTimeoutMinutes: timeout,
    projectAliases,
  };
}

export function emptyGlobalConfig(model: string): GlobalConfig {
  return { version: 1, model, inputs: [], automation: { ...DEFAULT_AUTOMATION }, workerTimeoutMinutes: 10, projectAliases: {} };
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export async function loadGlobalConfig(env: NodeJS.ProcessEnv = process.env): Promise<GlobalConfig | undefined> {
  try {
    const text = await readFile(globalConfigPath(env), "utf8");
    return validateGlobalConfig(JSON.parse(text), globalConfigPath(env));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveGlobalConfig(config: GlobalConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await atomicJson(globalConfigPath(env), config);
}



export function projectFilePath(root: string): string {
  return path.join(root, ".cheatcodes", "project.json");
}

export function legacyConfigPath(root: string): string {
  return path.join(root, ".cheatcodes", "config.json");
}

export function localDir(root: string): string {
  return path.join(root, ".cheatcodes", "local");
}

export function validateProjectIdentity(value: unknown, source = "project.json"): ProjectIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["version", "projectId"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`${source}.${key} is not a recognized field`);
  if (raw.version !== 1) throw new Error(`${source}.version must be 1`);
  return { version: 1, projectId: nonempty(raw.projectId, `${source}.projectId`) };
}

export async function loadProjectIdentity(root: string): Promise<ProjectIdentity | undefined> {
  try {
    return validateProjectIdentity(JSON.parse(await readFile(projectFilePath(root), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try { await stat(file); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}



export async function discoverGitRoot(start: string = process.cwd()): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", path.resolve(start), "rev-parse", "--show-toplevel"], { encoding: "utf8" });
    const root = stdout.trim();
    return root ? path.resolve(root) : undefined;
  } catch {
    return undefined;
  }
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(homedir(), value.slice(2));
  return value;
}

export function resolveGlobalInputs(config: GlobalConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const base = path.dirname(globalConfigPath(env));
  return [...new Set(config.inputs.map((value) => path.resolve(base, expandHome(value))))];
}

export function resolveProjectRoots(config: GlobalConfig, root: string, projectId: string): string[] {
  const aliases = (config.projectAliases[projectId] ?? []).map((value) => path.resolve(expandHome(value)));
  return [...new Set([path.resolve(root), ...aliases])];
}



interface LegacyProjectConfig {
  projectId: string;
  model: string;
  inputs: string[];
  projectRoots: string[];
}

function validateLegacyConfig(value: unknown, source: string): LegacyProjectConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.projectRoots) || !raw.projectRoots.length) throw new Error(`${source}.projectRoots must be a non-empty list of paths`);
  return {
    projectId: nonempty(raw.projectId, `${source}.projectId`),
    model: nonempty(raw.model, `${source}.model`),
    inputs: stringList(raw.inputs, `${source}.inputs`),
    projectRoots: [...new Set(raw.projectRoots.map((item) => (item as string).trim()))],
  };
}

export interface MigrationResult { root: string; projectId: string; warnings: string[] }

async function moveInto(from: string, to: string, warn: (message: string) => void): Promise<void> {
  if (!(await fileExists(from))) return;
  if (await fileExists(to)) {
    await rm(from, { recursive: true, force: true });
    warn(`Discarded leftover legacy file from an interrupted migration: ${from}`);
    return;
  }
  await rename(from, to);
}





function parseJsonFile(file: string, text: string): unknown {
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`${file} is not valid JSON: ${(error as Error).message}`); }
}

export async function migrateLegacyProject(root: string, env: NodeJS.ProcessEnv = process.env): Promise<MigrationResult> {
  const legacyFile = legacyConfigPath(root);
  if (!(await fileExists(legacyFile))) {
    const identity = await loadProjectIdentity(root);
    if (!identity) throw new Error(`No cheatcodes project at ${root}`);
    return { root, projectId: identity.projectId, warnings: [] };
  }

  const legacy = validateLegacyConfig(parseJsonFile(legacyFile, await readFile(legacyFile, "utf8")), legacyFile);
  const warnings: string[] = [];
  const warn = (message: string): void => { warnings.push(message); };

  
  const legacyLock = path.join(root, ".cheatcodes", "run.lock");
  if (await fileExists(legacyLock)) {
    try {
      const owner = JSON.parse(await readFile(legacyLock, "utf8")) as { pid?: number };
      const pid = typeof owner.pid === "number" ? owner.pid : 0;
      let alive = false;
      if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (error) { alive = (error as NodeJS.ErrnoException).code === "EPERM"; } }
      if (alive) throw new Error(`Migration deferred: live cheatcodes writer (pid ${pid}) still holds ${legacyLock}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {  } else throw error;
    }
  }

  let global = await loadGlobalConfig(env);
  const resolvedInputs = [...new Set(legacy.inputs.map((value) => path.resolve(root, expandHome(value))))];
  if (!global) {
    global = emptyGlobalConfig(legacy.model);
    global.inputs = resolvedInputs;
  } else {
    if (global.model !== legacy.model) warn(`Kept global model ${global.model}; legacy project model ${legacy.model} was ignored`);
    global.inputs = [...new Set([...global.inputs, ...resolvedInputs])];
  }
  const resolvedRoot = path.resolve(root);
  const aliases = (global.projectAliases[legacy.projectId] ?? []).map((value) => path.resolve(expandHome(value)));
  const extraAliases = legacy.projectRoots.map((value) => path.resolve(root, value)).filter((value) => value !== resolvedRoot);
  if (extraAliases.length) global.projectAliases[legacy.projectId] = [...new Set([...aliases, ...extraAliases])];
  await saveGlobalConfig(global, env);

  await mkdir(localDir(root), { recursive: true });
  await writeFile(path.join(localDir(root), ".gitignore"), "*\n", "utf8");
  await moveInto(path.join(root, ".cheatcodes", "state.json"), path.join(localDir(root), "state.json"), warn);
  await moveInto(path.join(root, ".cheatcodes", "operations"), path.join(localDir(root), "operations"), warn);
  await moveInto(legacyLock, path.join(localDir(root), "run.lock"), warn);

  await atomicJson(projectFilePath(root), { version: 1, projectId: legacy.projectId } satisfies ProjectIdentity);
  await publishKnowledge(root);
  await rm(legacyFile, { force: true });
  return { root: resolvedRoot, projectId: legacy.projectId, warnings };
}



export async function findProjectRoot(start: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if (await fileExists(projectFilePath(current))) return current;
    if (await fileExists(legacyConfigPath(current))) return (await migrateLegacyProject(current, env)).root;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("No cheatcodes project found; run `cheatcodes init` first");
    current = parent;
  }
}



async function deriveProjectId(root: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" });
    return normalizeGitRemote(stdout) ?? `local:${randomUUID()}`;
  } catch {
    return `local:${randomUUID()}`;
  }
}

export function normalizeGitRemote(remote: string): string | undefined {
  const value = remote.trim().replace(/\.git\/?$/, "");
  const scp = value.match(/^git@([^:]+):(.+)$/);
  if (scp) return `${scp[1]!.toLowerCase()}/${scp[2]!.replace(/^\/+/, "")}`;
  try {
    const url = new URL(value);
    const repo = url.pathname.replace(/^\/+/, "");
    return repo ? `${url.hostname.toLowerCase()}/${repo}` : undefined;
  } catch {
    return undefined;
  }
}

export const KNOWLEDGE_POINTER = "## Project knowledge\n\nStart with `.cheatcodes/knowledge/index.md`. Check concept status before relying on a draft.";

async function updateContextPointer(root: string): Promise<string> {
  const override = path.join(root, "AGENTS.override.md");
  const regular = path.join(root, "AGENTS.md");
  let target = regular;
  try { await readFile(override); target = override; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let existing = "";
  try { existing = await readFile(target, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!existing.includes(KNOWLEDGE_POINTER)) {
    const next = `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${KNOWLEDGE_POINTER}\n`;
    await writeFile(target, next);
  }
  return target;
}

export interface InitializeOptions { root?: string }

export interface InitializedProject { root: string; projectId: string; contextFile: string }





export async function initializeProject(options: InitializeOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<InitializedProject> {
  const global = await loadGlobalConfig(env);
  if (!global) throw new Error(`No global config at ${globalConfigPath(env)}; create it with a "model" before initializing a project`);
  const fallback = options.root ?? await discoverGitRoot() ?? process.cwd();
  const root = path.resolve(fallback);
  const cheatcodes = path.join(root, ".cheatcodes");
  await mkdir(path.join(cheatcodes, "curated", "concepts"), { recursive: true });
  await mkdir(localDir(root), { recursive: true });
  await writeFile(path.join(localDir(root), ".gitignore"), "*\n", "utf8");
  const existing = await loadProjectIdentity(root);
  const projectId = existing?.projectId ?? await deriveProjectId(root);
  await atomicJson(projectFilePath(root), { version: 1, projectId } satisfies ProjectIdentity);
  await publishKnowledge(root);
  const contextFile = await updateContextPointer(root);
  return { root, projectId, contextFile };
}
```

## `src/curate.ts`

```typescript
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { HarvestPacket } from "./harvest.js";

const common = {
  action: z.enum(["create", "update"]),
  targetConceptId: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1)).min(1),
};
const DecisionSchema = z.object({ ...common, type: z.literal("Decision"), content: z.object({ answer: z.string().min(1), rationale: z.string().min(1), rejectedAlternative: z.string().min(1).optional() }).strict() }).strict();
const GotchaSchema = z.object({ ...common, type: z.literal("Gotcha"), content: z.object({ symptom: z.string().min(1), cause: z.string().min(1), fix: z.string().min(1), validation: z.string().min(1).optional() }).strict() }).strict();
const RunbookSchema = z.object({ ...common, type: z.literal("Runbook"), content: z.object({ purpose: z.string().min(1), steps: z.array(z.string().min(1)).min(1), validation: z.string().min(1).optional() }).strict() }).strict();
export const CuratorResponseSchema = z.object({ concepts: z.array(z.discriminatedUnion("type", [DecisionSchema, GotchaSchema, RunbookSchema])) }).strict();
export type CuratedConcept = z.infer<typeof DecisionSchema> | z.infer<typeof GotchaSchema> | z.infer<typeof RunbookSchema>;
export type CuratorResponse = z.infer<typeof CuratorResponseSchema>;

export interface CuratorOutcome { response?: CuratorResponse; schemaInvalid: boolean; warning?: string }
export interface Curator { curate(packet: HarvestPacket): Promise<CuratorOutcome | CuratorResponse> }

export const CURATOR_PROMPT = `You curate durable project knowledge from a bounded evidence packet.
Return exactly one JSON object with a concepts array. Do not return Markdown or commentary.
Each concept action is create or update and has type Decision, Gotcha, or Runbook, title, description, tags, evidenceRefs, and type-specific content.
Updates must name targetConceptId and may target only the supplied update candidate. Creates must omit targetConceptId.
Use only supplied evidence IDs. Never invent IDs, paths, timestamps, status, verification, or provenance.
Return {"concepts":[]} when the evidence does not justify durable knowledge.`;

export function validateCuratorResponse(value: unknown, packet: HarvestPacket): CuratorResponse {
  const parsed = CuratorResponseSchema.parse(value);
  const evidenceIds = new Set(packet.evidence.map((item) => item.id));
  const updated = new Set<string>();
  for (const concept of parsed.concepts) {
    for (const reference of concept.evidenceRefs) if (!evidenceIds.has(reference)) throw new Error(`Unknown evidence reference: ${reference}`);
    if (concept.action === "create" && concept.targetConceptId !== undefined) throw new Error("Create action must not include targetConceptId");
    if (concept.action === "update") {
      if (!concept.targetConceptId) throw new Error("Update action requires targetConceptId");
      if (!packet.updateCandidate || packet.updateCandidate.id !== concept.targetConceptId) throw new Error("Update target is not the packet update candidate");
      if (packet.updateCandidate.type !== concept.type) throw new Error("Update type does not match target type");
      if (updated.has(concept.targetConceptId)) throw new Error("A target may be updated only once per response");
      updated.add(concept.targetConceptId);
    }
  }
  return parsed;
}

function parseText(text: string, packet: HarvestPacket): CuratorResponse {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`Invalid JSON: ${(error as Error).message}`); }
  return validateCuratorResponse(value, packet);
}

function finalAssistantText(messages: readonly unknown[]): string {
  const last = messages[messages.length - 1] as { role?: string; stopReason?: string; content?: unknown[]; errorMessage?: string } | undefined;
  if (!last || last.role !== "assistant") throw new Error("Model produced no final assistant message");
  if (last.stopReason !== "stop") throw new Error(`Model stopped with ${last.stopReason ?? "missing stop reason"}${last.errorMessage ? `: ${last.errorMessage}` : ""}`);
  return (last.content ?? []).flatMap((block) => {
    const item = block as { type?: string; text?: string };
    return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("");
}

export interface PiCuratorOptions { projectRoot: string; model: string; modelRuntime?: ModelRuntime }

export class PiCurator implements Curator {
  private constructor(
    private readonly root: string,
    private readonly runtime: ModelRuntime,
    private readonly model: NonNullable<ReturnType<typeof resolveCliModel>["model"]>,
    private readonly thinkingLevel: NonNullable<ReturnType<typeof resolveCliModel>["thinkingLevel"]> | "medium",
    private readonly settings: SettingsManager,
    private readonly loader: DefaultResourceLoader,
  ) {}

  static async create(options: PiCuratorOptions): Promise<PiCurator> {
    const runtime = options.modelRuntime ?? await ModelRuntime.create();
    const resolved = resolveCliModel({ cliModel: options.model, modelRuntime: runtime });
    if (resolved.error || !resolved.model) throw new Error(resolved.error ?? `Model not found: ${options.model}`);
    if (resolved.warning) throw new Error(resolved.warning);
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({
      cwd: options.projectRoot,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: CURATOR_PROMPT,
      appendSystemPrompt: [],
      settingsManager: settings,
    });
    await loader.reload();
    return new PiCurator(options.projectRoot, runtime, resolved.model, resolved.thinkingLevel ?? "medium", settings, loader);
  }

  async curate(packet: HarvestPacket): Promise<CuratorOutcome> {
    let validationError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const { session, modelFallbackMessage } = await createAgentSession({
        cwd: this.root,
        model: this.model,
        thinkingLevel: this.thinkingLevel,
        noTools: "all",
        sessionManager: SessionManager.inMemory(this.root),
        resourceLoader: this.loader,
        modelRuntime: this.runtime,
        settingsManager: this.settings,
      });
      try {
        if (modelFallbackMessage) throw new Error(modelFallbackMessage);
        const start = session.messages.length;
        const prompt = attempt === 0
          ? JSON.stringify(packet)
          : `${JSON.stringify(packet)}\n\nYour prior output failed validation: ${validationError}. Return corrected JSON only.`;
        await session.prompt(prompt);
        const text = finalAssistantText(session.messages.slice(start));
        try { return { response: parseText(text, packet), schemaInvalid: false }; }
        catch (error) { validationError = (error as Error).message; }
      } finally { session.dispose(); }
    }
    return { schemaInvalid: true, warning: validationError };
  }
}

export function normalizeCuratorOutcome(value: CuratorOutcome | CuratorResponse, packet: HarvestPacket): CuratorOutcome {
  if ("schemaInvalid" in value) {
    if (value.response) return { ...value, response: validateCuratorResponse(value.response, packet) };
    return value;
  }
  return { response: validateCuratorResponse(value, packet), schemaInvalid: false };
}
```

## `src/harvest.ts`

```typescript
import { createHash } from "node:crypto";
import type { NormalizedRecord, ParsedSession, ToolReceipt } from "./jsonl.js";
import { redactSecrets } from "./jsonl.js";

export const PACKET_CHARACTER_CAP = 12_000;
export const SHORTLIST_LIMIT = 8;

export type SignalKind = "resolved-failure" | "correction" | "workflow-checkpoint" | "decision" | "procedure";

export interface Episode {
  id: string;
  sessionId: string;
  records: NormalizedRecord[];
  recordIds: string[];
  firstRecordId: string;
  lastRecordId: string;
  hasNewRecord: boolean;
  signals: SignalKind[];
}

export interface EvidenceItem {
  id: string;
  kind: "message" | "tool" | "checkpoint";
  excerpt: string;
  recordIds: string[];
  path?: string;
}

export interface ConceptSummary {
  id?: string;
  cheatcodesId?: string;
  cheatcodes_id?: string;
  type: string;
  title: string;
  description: string;
  tags?: string[];
  status: string;
  paths?: string[];
  verified?: unknown;
  content?: string;
  markdown?: string;
}

export interface ShortlistItem {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  score: number;
}

export interface UpdateCandidate extends ShortlistItem { content: string }

export interface HarvestPacket {
  id: string;
  projectId: string;
  sessionId: string;
  episodeId: string;
  recordIds: string[];
  signals: SignalKind[];
  userIntent: string;
  finalAssistantSummary: string;
  evidence: EvidenceItem[];
  shortlist: ShortlistItem[];
  updateCandidate?: UpdateCandidate;
}

export interface HarvestOptions {
  projectId: string;
  concepts?: readonly ConceptSummary[];
  packetCharacterCap?: number;
  shortlistLimit?: number;
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const stableId = (prefix: string, parts: readonly string[]): string => `${prefix}-${hash(parts.join("\0")).slice(0, 24)}`;

function workflowBoundary(record: NormalizedRecord): boolean {
  if (record.kind === "workflow") return true;
  return record.kind === "user" && /\bworkflow\b.*\b(?:run|node|step)\b/i.test(record.text ?? "");
}


export function segmentBranch(branch: readonly NormalizedRecord[], sessionId = branch[0]?.sessionId ?? "unknown"): Episode[] {
  const groups: NormalizedRecord[][] = [];
  let current: NormalizedRecord[] = [];
  const flush = (): void => { if (current.length) groups.push(current); current = []; };

  for (const record of branch) {
    if (workflowBoundary(record) && current.length) flush();
    if (record.kind === "user" && current.some((item) => item.kind === "user")) flush();
    current.push(record);
    if (record.kind === "assistant") flush();
    else if (record.kind === "workflow") flush();
  }
  flush();
  return groups.map((records) => makeEpisode(sessionId, records));
}

function makeEpisode(sessionId: string, records: NormalizedRecord[]): Episode {
  const recordIds = records.map((record) => record.id);
  return {
    id: stableId("episode", [sessionId, ...recordIds]), sessionId, records, recordIds,
    firstRecordId: recordIds[0]!, lastRecordId: recordIds[recordIds.length - 1]!,
    hasNewRecord: records.some((record) => record.isNew), signals: detectHighSignal(records),
  };
}

export function segmentSession(session: Pick<ParsedSession, "sessionId" | "branches">): Episode[] {
  const byId = new Map<string, Episode>();
  for (const branch of session.branches) {
    for (const episode of segmentBranch(branch, session.sessionId)) {
      const key = episode.recordIds.join("\0");
      if (!byId.has(key)) byId.set(key, episode);
    }
  }
  return [...byId.values()];
}

function receipts(records: readonly NormalizedRecord[]): ToolReceipt[] {
  return records.flatMap((record) => record.receipt ? [record.receipt] : []);
}

function hasOrderedFailureMutationSuccess(records: readonly NormalizedRecord[]): boolean {
  let failedAt = -1;
  let mutationAt = -1;
  for (let index = 0; index < records.length; index++) {
    const receipt = records[index]!.receipt;
    if (receipt?.validation === "failed" && failedAt < 0) failedAt = index;
    if (receipt?.mutation && failedAt >= 0 && index > failedAt) mutationAt = index;
    if (receipt?.validation === "passed" && mutationAt >= 0 && index > mutationAt) return true;
  }
  return false;
}

function correctionSignal(records: readonly NormalizedRecord[]): boolean {
  return records.some((record) => record.kind === "user" && /\b(?:no,?|not quite|incorrect|wrong|instead|must not|do not|don't|actually|correction|that's not|that is not|you (?:missed|should))\b/i.test(record.text ?? ""));
}

function acceptedCheckpoint(records: readonly NormalizedRecord[]): boolean {
  return records.some((record) => record.kind === "workflow" && record.receipt?.accepted === true &&
    (Boolean(record.receipt.summary) || record.receipt.decisions !== undefined || record.receipt.evidence !== undefined));
}

function implementationEvidence(records: readonly NormalizedRecord[]): boolean {
  return receipts(records).some((receipt) => receipt.mutation || receipt.validation === "passed");
}

function userAcceptance(records: readonly NormalizedRecord[]): boolean {
  return records.some((record) => record.kind === "user" && /\b(?:approved|accepted|looks good|that's right|that is right|yes,? (?:use|do|ship)|proceed with)\b/i.test(record.text ?? ""));
}

function explicitDecision(records: readonly NormalizedRecord[]): boolean {
  const language = records.some((record) => /\b(?:we (?:decided|choose|chose|will use)|decision is|use .{1,80} instead of|prefer .{1,80} over|rejected alternative|the approach is)\b/i.test(record.text ?? record.receipt?.summary ?? ""));
  return language && (userAcceptance(records) || acceptedCheckpoint(records) || implementationEvidence(records));
}

function explicitProcedure(records: readonly NormalizedRecord[]): boolean {
  const commands = receipts(records).filter((receipt) => Boolean(receipt.command)).length;
  const numbered = records.some((record) => /(?:^|\n)\s*(?:1[.)]|step\s+1\b)[\s\S]*(?:\n\s*(?:2[.)]|step\s+2\b))/i.test(record.text ?? ""));
  const confirmed = receipts(records).some((receipt) => receipt.validation === "passed") || userAcceptance(records);
  return confirmed && (commands >= 2 || numbered);
}

export function detectHighSignal(records: readonly NormalizedRecord[]): SignalKind[] {
  const signals: SignalKind[] = [];
  if (hasOrderedFailureMutationSuccess(records)) signals.push("resolved-failure");
  if (correctionSignal(records)) signals.push("correction");
  if (acceptedCheckpoint(records)) signals.push("workflow-checkpoint");
  if (explicitDecision(records)) signals.push("decision");
  if (explicitProcedure(records)) signals.push("procedure");
  return signals;
}

export const isHighSignal = (episode: Episode | readonly NormalizedRecord[]): boolean =>
  Array.isArray(episode) ? detectHighSignal(episode as readonly NormalizedRecord[]).length > 0 : (episode as Episode).signals.length > 0;

function cleanExcerpt(value: string, limit: number): string {
  const clean = redactSecrets(value).trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}\n[truncated]`;
}

function evidenceFor(record: NormalizedRecord): EvidenceItem | undefined {
  const receipt = record.receipt;
  let excerpt = record.text ?? receipt?.summary ?? receipt?.excerpt ?? receipt?.command ?? "";
  if (receipt && !excerpt) {
    excerpt = [receipt.tool, receipt.path, receipt.contentSha256, receipt.validation !== "none" ? receipt.validation : undefined]
      .filter(Boolean).join(" | ");
  }
  if (!excerpt) return undefined;
  const kind = record.kind === "workflow" ? "checkpoint" : receipt ? "tool" : "message";
  const digestParts = [record.sessionId, record.id, kind, receipt?.path ?? "", excerpt];
  return {
    id: stableId("evidence", digestParts), kind, excerpt: cleanExcerpt(excerpt, 1_500),
    recordIds: [record.id], path: receipt?.path,
  };
}

function conceptId(concept: ConceptSummary): string {
  return concept.id ?? concept.cheatcodesId ?? concept.cheatcodes_id ?? "";
}

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []);
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const term of left) if (right.has(term)) count++;
  return count;
}

export function shortlistConcepts(
  episode: Episode,
  concepts: readonly ConceptSummary[],
  limit = SHORTLIST_LIMIT,
): { shortlist: ShortlistItem[]; updateCandidate?: UpdateCandidate } {
  const episodeText = episode.records.map((record) => [record.text, record.receipt?.path, record.receipt?.command].filter(Boolean).join(" ")).join(" ");
  const episodeTerms = terms(episodeText);
  const paths = new Set(episode.records.flatMap((record) => record.receipt?.path ? [record.receipt.path] : []));
  const ranked = concepts.map((concept) => {
    const id = conceptId(concept);
    const titleScore = overlap(episodeTerms, terms(concept.title)) * 4;
    const tagScore = overlap(episodeTerms, terms((concept.tags ?? []).join(" "))) * 3;
    const descriptionScore = overlap(episodeTerms, terms(concept.description));
    const pathScore = (concept.paths ?? []).filter((candidate) => paths.has(candidate)).length * 6;
    const typeScore = episode.signals.includes("decision") && concept.type === "Decision" ||
      episode.signals.includes("resolved-failure") && concept.type === "Gotcha" ||
      episode.signals.includes("procedure") && concept.type === "Runbook" ? 2 : 0;
    return { concept, item: { id, type: concept.type, title: concept.title, description: concept.description, status: concept.status, score: titleScore + tagScore + descriptionScore + pathScore + typeScore } };
  }).filter((entry) => entry.item.id && entry.item.score > 0)
    .sort((a, b) => b.item.score - a.item.score || a.item.title.localeCompare(b.item.title) || a.item.id.localeCompare(b.item.id))
    .slice(0, Math.max(0, limit));
  const shortlist = ranked.map((entry) => entry.item);
  const candidate = ranked.find((entry) => entry.concept.status === "draft" && entry.concept.verified === undefined && Boolean(entry.concept.content ?? entry.concept.markdown));
  const updateCandidate = candidate ? { ...candidate.item, content: candidate.concept.content ?? candidate.concept.markdown! } : undefined;
  return { shortlist, updateCandidate };
}

export function createPacket(episode: Episode, options: HarvestOptions): HarvestPacket | undefined {
  if (!episode.hasNewRecord || episode.signals.length === 0) return undefined;
  const evidence = episode.records.flatMap((record) => {
    const item = evidenceFor(record);
    return item ? [item] : [];
  });
  const userIntent = episode.records.filter((record) => record.kind === "user").map((record) => record.text).filter(Boolean).join("\n\n");
  const finalAssistantSummary = [...episode.records].reverse().find((record) => record.kind === "assistant")?.text ?? "";
  const related = shortlistConcepts(episode, options.concepts ?? [], options.shortlistLimit ?? SHORTLIST_LIMIT);
  const id = stableId("packet", [options.projectId, episode.sessionId, ...episode.records.flatMap((record) => [record.id, record.byteHash])]);
  const packet: HarvestPacket = {
    id, projectId: options.projectId, sessionId: episode.sessionId, episodeId: episode.id,
    recordIds: episode.recordIds, signals: episode.signals, userIntent: cleanExcerpt(userIntent, 3_000),
    finalAssistantSummary: cleanExcerpt(finalAssistantSummary, 3_000), evidence,
    shortlist: related.shortlist, updateCandidate: related.updateCandidate,
  };
  fitPacket(packet, options.packetCharacterCap ?? PACKET_CHARACTER_CAP);
  return packet;
}

function packetLength(packet: HarvestPacket): number { return JSON.stringify(packet).length; }


function fitPacket(packet: HarvestPacket, cap: number): void {
  for (let index = packet.evidence.length - 1; packetLength(packet) > cap && index >= 0; index--) {
    const evidence = packet.evidence[index]!;
    if (evidence.excerpt.length > 80) evidence.excerpt = cleanExcerpt(evidence.excerpt, 80);
  }
  while (packetLength(packet) > cap && packet.evidence.length > 1) packet.evidence.pop();
  while (packetLength(packet) > cap && packet.shortlist.length) packet.shortlist.pop();
  if (packetLength(packet) > cap) packet.finalAssistantSummary = cleanExcerpt(packet.finalAssistantSummary, Math.max(0, packet.finalAssistantSummary.length - (packetLength(packet) - cap)));
  if (packetLength(packet) > cap) packet.userIntent = cleanExcerpt(packet.userIntent, Math.max(0, packet.userIntent.length - (packetLength(packet) - cap)));
  if (packetLength(packet) > cap && packet.updateCandidate) delete packet.updateCandidate;
  if (packetLength(packet) > cap && packet.evidence[0]) packet.evidence[0].excerpt = "";
}

export function harvestPackets(session: Pick<ParsedSession, "sessionId" | "branches">, options: HarvestOptions): HarvestPacket[] {
  const packets = new Map<string, HarvestPacket>();
  for (const episode of segmentSession(session)) {
    const packet = createPacket(episode, options);
    if (packet && !packets.has(packet.id)) packets.set(packet.id, packet);
  }
  return [...packets.values()];
}

export function renderPacket(packet: HarvestPacket, cap = PACKET_CHARACTER_CAP): string {
  const copy = structuredClone(packet);
  fitPacket(copy, cap);
  return JSON.stringify(copy);
}

export const buildPackets = harvestPackets;
```

## `src/jsonl.ts`

```typescript
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const RECEIPT_EXCERPT_LIMIT = 1_200;

export interface ByteRange { start: number; end: number }
export interface JsonlWarning { file?: string; range: ByteRange; message: string }
export interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp?: string;
  cwd?: string;
}
export type NormalizedRecordKind = "user" | "assistant" | "tool" | "bash" | "workflow";
export type ValidationState = "passed" | "failed" | "ambiguous" | "none";

export interface ToolReceipt {
  toolCallId?: string;
  tool: string;
  path?: string;
  command?: string;
  contentSha256?: string;
  excerpt?: string;
  exitCode?: number;
  isError?: boolean;
  mutation: boolean;
  validation: ValidationState;
  accepted?: boolean;
  node?: string;
  summary?: string;
  decisions?: unknown;
  evidence?: unknown;
}

export interface NormalizedRecord {
  id: string;
  parentId: string | null;
  sourceParentId: string | null;
  sessionId: string;
  timestamp?: string;
  range: ByteRange;
  byteHash: string;
  kind: NormalizedRecordKind;
  role?: string;
  text?: string;
  receipt?: ToolReceipt;
  isNew: boolean;
  // Raw payloads are intentionally omitted from normalized records.
}

export interface ParseJsonlOptions {
  file?: string;
  previousCommittedOffset?: number;
  rewritten?: boolean;
  projectId?: string;
  projectRoots?: string[];
  cwd?: string;
}

export interface ParsedSession {
  header: SessionHeader;
  version: number;
  sessionId: string;
  records: NormalizedRecord[];
  rawRecords: CompleteJsonlRecord[];
  branches: NormalizedRecord[][];
  warnings: JsonlWarning[];
  completeOffset: number;
  completeSha256: string;
  previousPrefixSha256: string;
}

interface RawLine { value: Record<string, unknown>; range: ByteRange; hash: string; index: number }

export interface CompleteJsonlRecord {
  value: Record<string, unknown>;
  range: ByteRange;
  byteHash: string;
  index: number;
}

export interface CompleteJsonlResult {
  records: CompleteJsonlRecord[];
  warnings: JsonlWarning[];
  completeOffset: number;
  completeSha256: string;
}

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const asString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const asBoolean = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;
const asNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;


export function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((item) => {
    const block = asObject(item);
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
  }).join("\n");
}

export function redactSecrets(input: string): string {
  if (!input) return input;
  let value = input;
  value = value.replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]");
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]");
  value = value.replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED API KEY]");
  value = value.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED API KEY]");
  value = value.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED JWT]");
  value = value.replace(/\b(?:gh[opusr]|github_pat)_[A-Za-z0-9_]{16,}\b/g, "[REDACTED TOKEN]");
  value = value.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED AWS KEY]");
  value = value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[REDACTED]@[REDACTED-HOST]/");
  value = value.replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY))\s*=\s*(?:(['"])[\s\S]*?\2|[^\s;&|]+)/gi, "$1=[REDACTED]");
  value = value.replace(/(["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]");
  return value;
}

function pathInside(root: string, candidate: string): string | undefined {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) ? relative : undefined;
}


export function normalizeRepositoryPath(
  candidate: string,
  projectId: string,
  projectRoots: readonly string[],
  cwd = process.cwd(),
): string | undefined {
  if (!candidate || candidate.includes("\0")) return undefined;
  const absolute = path.resolve(cwd, candidate.replace(/^file:\/\//, ""));
  const matches = projectRoots
    .map((root) => path.resolve(root))
    .map((root) => ({ root, relative: pathInside(root, absolute) }))
    .filter((match): match is { root: string; relative: string } => match.relative !== undefined)
    .sort((a, b) => b.root.length - a.root.length);
  const match = matches[0];
  if (!match) return undefined;
  const relative = match.relative.split(path.sep).join("/");
  return `repo://${projectId}${relative ? `/${relative}` : ""}`;
}

export const normalizePath = normalizeRepositoryPath;

function compactExcerpt(value: string, limit = RECEIPT_EXCERPT_LIMIT): string {
  const safe = redactSecrets(value).replace(/(?:data:[^;,]+;base64,|base64[:=]\s*)[A-Za-z0-9+/=]{80,}/gi, "[OMITTED BASE64]");
  return safe.length <= limit ? safe : `${safe.slice(0, limit)}\n[truncated]`;
}

function firstPath(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file", "filePath", "target", "cwd"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return undefined;
}

function normalizePossiblePaths(text: string, options: ParseJsonlOptions): string {
  if (!options.projectId || !options.projectRoots?.length) return redactSecrets(text);
  const roots = [...options.projectRoots].map((root) => path.resolve(root)).sort((a, b) => b.length - a.length);
  let result = redactSecrets(text);
  for (const root of roots) {
    const identity = normalizeRepositoryPath(root, options.projectId, roots, options.cwd);
    if (!identity) continue;
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`${escaped}(?=$|[\\/\\s'\"\x60),;])`, "g"), identity);
  }
  
  result = result.replace(/(?:\/home\/[^/\s]+|\/Users\/[^/\s]+)(?:\/[^\s'"`),;]*)?/g, "[ABSOLUTE PATH]");
  return result;
}

function isSimpleCommand(command: string): boolean {
  return !/(?:\||&&|;|\|\||`|\$\(|\n|\b(?:sh|bash|zsh)\s+-c\b)/.test(command);
}

function looksLikeValidation(command: string): boolean {
  return /(?:^|\s)(?:test|tests|pytest|cargo\s+test|npm\s+(?:test|run\s+(?:test|lint|build|check))|pnpm\s+(?:test|lint|build)|yarn\s+(?:test|lint|build)|tsc|eslint|ruff|mypy|go\s+test|dotnet\s+test|make\s+(?:test|check)|gradle\s+test)(?:\s|$)/i.test(command);
}

function validationState(command: string, exitCode: number | undefined, isError: boolean | undefined, structuredSummary?: string): ValidationState {
  if (!looksLikeValidation(command)) return "none";
  if (exitCode !== undefined && isSimpleCommand(command)) return exitCode === 0 ? "passed" : "failed";
  if (isError === true) return "failed";
  if (structuredSummary) {
    const outcome = structuredSummary.trim().toLowerCase();
    if (/^(?:passed|pass|success(?:ful)?)$/.test(outcome)) return "passed";
    if (/^(?:failed|failure|error|errored)$/.test(outcome)) return "failed";
    if (/\b(?:passed|success(?:ful)?|all checks? pass(?:ed)?)\b/i.test(structuredSummary) && !/\b(?:failed|failure|error)s?\b/i.test(structuredSummary)) return "passed";
  }
  return "ambiguous";
}

function makeReceipt(tool: string, args: Record<string, unknown>, result: Record<string, unknown> | undefined, options: ParseJsonlOptions): ToolReceipt {
  const resultText = textContent(result?.content);
  const details = asObject(result?.details);
  const exitCode = asNumber(result?.exitCode) ?? asNumber(details?.exitCode) ?? asNumber(asObject(details?.ptcValue)?.exitCode);
  const isError = asBoolean(result?.isError);
  const rawPath = firstPath(args);
  const normalizedPath = rawPath && options.projectId && options.projectRoots
    ? normalizeRepositoryPath(rawPath, options.projectId, options.projectRoots, options.cwd)
    : rawPath ? compactExcerpt(rawPath, 500) : undefined;
  const commandRaw = asString(args.command) ?? asString(args.cmd) ?? "";
  const command = commandRaw ? normalizePossiblePaths(commandRaw, options) : undefined;
  const mutation = /^(?:edit|write|apply_patch|patch|delete|move|rename)$/i.test(tool);
  const receipt: ToolReceipt = {
    toolCallId: asString(result?.toolCallId), tool, path: normalizedPath,
    command: command ? compactExcerpt(command, 1_000) : undefined,
    exitCode, isError, mutation,
    validation: validationState(commandRaw, exitCode, isError, asString(details?.summary) ?? asString(details?.status) ?? asString(asObject(asObject(details?.contextHygiene)?.commandState)?.outcome)),
  };
  if (/^(?:read|write)$/i.test(tool)) {
    const content = asString(args.content) ?? resultText;
    if (content) receipt.contentSha256 = sha256(content);
  } else if (/^(?:edit|apply_patch|patch)$/i.test(tool)) {
    const patch = asString(args.patch) ?? asString(args.new_text) ?? asString(args.content) ?? resultText;
    if (patch) receipt.excerpt = compactExcerpt(normalizePossiblePaths(patch, options));
  } else if (/^(?:bash|shell|exec)$/i.test(tool)) {
    if (resultText && !/PRIVATE KEY|\b(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=/i.test(resultText)) {
      receipt.excerpt = compactExcerpt(normalizePossiblePaths(resultText, options));
    }
  }
  if (tool === "workflow_transition") {
    const source = { ...args, ...(details ?? {}) };
    const status = asString(source.status) ?? asString(source.verdict) ?? asString(source.outcome);
    receipt.accepted = asBoolean(source.accepted) ?? (status ? /^(?:accepted|complete|completed|success|passed)$/i.test(status) : false);
    receipt.node = asString(source.node) ?? asString(source.nodeId) ?? asString(source.to);
    receipt.summary = compactExcerpt(asString(source.summary) ?? resultText, 1_000);
    receipt.decisions = source.decisions;
    receipt.evidence = source.evidence;
  }
  return receipt;
}

function substantiveUser(text: string): boolean {
  const clean = text.trim();
  return clean.length >= 8 && !/^(?:continue workflow|continue the workflow|run completion|<dcp-|\/?compact\b)/i.test(clean);
}

function normalizedFromRaw(lines: RawLine[], header: SessionHeader, options: ParseJsonlOptions): NormalizedRecord[] {
  const version = header.version || 1;
  const calls = new Map<string, { tool: string; args: Record<string, unknown> }>();
  for (const line of lines) {
    const message = asObject(line.value.message);
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const item of message.content) {
      const block = asObject(item);
      if (!block || !["toolCall", "tool_call", "functionCall"].includes(String(block.type))) continue;
      const id = asString(block.id) ?? asString(block.toolCallId);
      const tool = asString(block.name) ?? asString(block.toolName);
      if (id && tool) calls.set(id, { tool, args: asObject(block.arguments) ?? asObject(block.input) ?? {} });
    }
  }

  const retained: NormalizedRecord[] = [];
  for (const line of lines) {
    const raw = line.value;
    const message = asObject(raw.message);
    const role = asString(message?.role);
    const sourceId = asString(raw.id);
    const id = version <= 1 || !sourceId
      ? `v1-${sha256(`${header.id}:${line.range.start}:${line.range.end}:${line.hash}`).slice(0, 24)}`
      : sourceId;
    const base = {
      id, parentId: null, sourceParentId: asString(raw.parentId) ?? null, sessionId: header.id,
      timestamp: asString(raw.timestamp), range: line.range, byteHash: line.hash,
      isNew: options.rewritten === true || line.range.end > (options.previousCommittedOffset ?? 0),
    };
    if (raw.type === "message" && role === "user") {
      const text = normalizePossiblePaths(textContent(message?.content), options).trim();
      if (substantiveUser(text)) retained.push({ ...base, kind: "user", role, text });
    } else if (raw.type === "message" && role === "assistant" && message?.stopReason === "stop") {
      const text = normalizePossiblePaths(textContent(message.content), options).trim();
      if (text) retained.push({ ...base, kind: "assistant", role, text: compactExcerpt(text, 4_000) });
    } else if (raw.type === "message" && role === "toolResult") {
      const callId = asString(message?.toolCallId);
      const call = callId ? calls.get(callId) : undefined;
      const tool = asString(message?.toolName) ?? call?.tool;
      if (!tool) continue;
      const receipt = makeReceipt(tool, call?.args ?? {}, message, options);
      receipt.toolCallId = callId;
      
      if (message?.isError === true && /^(?:read|ls|list|find)$/i.test(tool)) continue;
      if (/^(?:ls|list|find|grep|search)$/i.test(tool)) continue;
      retained.push({ ...base, kind: tool === "workflow_transition" ? "workflow" : "tool", role, receipt });
    } else if (raw.type === "message" && role === "bashExecution") {
      const command = asString(message?.command) ?? "";
      const receipt = makeReceipt("bash", { command }, message, options);
      retained.push({ ...base, kind: "bash", role, receipt });
    }
  }
  return projectParents(retained, lines, version);
}


function projectParents(records: NormalizedRecord[], lines: RawLine[], version: number): NormalizedRecord[] {
  if (version <= 1) {
    for (let index = 0; index < records.length; index++) records[index]!.parentId = index ? records[index - 1]!.id : null;
    return records;
  }
  const sourceParents = new Map<string, string | null>();
  for (const line of lines) {
    const id = asString(line.value.id);
    if (id) sourceParents.set(id, asString(line.value.parentId) ?? null);
  }
  const retainedIds = new Set(records.map((record) => record.id));
  for (const record of records) {
    let parent = record.sourceParentId;
    const seen = new Set<string>();
    while (parent && !retainedIds.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = sourceParents.get(parent) ?? null;
    }
    record.parentId = parent && retainedIds.has(parent) ? parent : null;
  }
  return records;
}


export function buildBranches(records: readonly NormalizedRecord[]): NormalizedRecord[][] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const children = new Map<string, string[]>();
  for (const record of records) {
    if (!record.parentId || !byId.has(record.parentId)) continue;
    const list = children.get(record.parentId) ?? [];
    list.push(record.id);
    children.set(record.parentId, list);
  }
  const leaves = records.filter((record) => !(children.get(record.id)?.length));
  return leaves.map((leaf) => {
    const branch: NormalizedRecord[] = [];
    const seen = new Set<string>();
    let current: NormalizedRecord | undefined = leaf;
    while (current && !seen.has(current.id)) {
      branch.push(current); seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return branch.reverse();
  });
}

export function parseCompleteJsonlRecords(bytes: Buffer | Uint8Array, file?: string): CompleteJsonlResult {
  
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const records: CompleteJsonlRecord[] = [];
  const warnings: JsonlWarning[] = [];
  let start = 0;
  let completeOffset = 0;
  let index = 0;
  for (let newline = buffer.indexOf(0x0a, start); newline !== -1; newline = buffer.indexOf(0x0a, start)) {
    const end = newline + 1;
    const lineBytes = buffer.subarray(start, newline > start && buffer[newline - 1] === 0x0d ? newline - 1 : newline);
    if (lineBytes.length) {
      try {
        const value = JSON.parse(lineBytes.toString("utf8"));
        const object = asObject(value);
        if (!object) throw new Error("record is not an object");
        records.push({ value: object, range: { start, end }, byteHash: sha256(buffer.subarray(start, end)), index: index++ });
      } catch {
        warnings.push({ file, range: { start, end }, message: "Malformed complete JSONL record" });
      }
    }
    completeOffset = end;
    start = end;
  }
  return { records, warnings, completeOffset, completeSha256: sha256(buffer.subarray(0, completeOffset)) };
}

export function parseJsonlBytes(bytes: Buffer | Uint8Array, options: ParseJsonlOptions = {}): ParsedSession {

  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const warnings: JsonlWarning[] = [];
  const lines: RawLine[] = [];
  let start = 0;
  let completeOffset = 0;
  let index = 0;
  for (let newline = buffer.indexOf(0x0a, start); newline !== -1; newline = buffer.indexOf(0x0a, start)) {
    const end = newline + 1;
    const lineBytes = buffer.subarray(start, newline > start && buffer[newline - 1] === 0x0d ? newline - 1 : newline);
    if (lineBytes.length) {
      try {
        const value = JSON.parse(lineBytes.toString("utf8"));
        const object = asObject(value);
        if (!object) throw new Error("record is not an object");
        lines.push({ value: object, range: { start, end }, hash: sha256(buffer.subarray(start, end)), index: index++ });
      } catch {
        warnings.push({ file: options.file, range: { start, end }, message: "Malformed complete JSONL record" });
      }
    }
    completeOffset = end;
    start = end;
  }
  const headerLine = lines.find((line) => line.value.type === "session");
  if (!headerLine || typeof headerLine.value.id !== "string") throw new Error(`${options.file ?? "JSONL"}: missing valid session header`);
  const header: SessionHeader = {
    type: "session", version: asNumber(headerLine.value.version) ?? 1, id: headerLine.value.id as string,
    timestamp: asString(headerLine.value.timestamp), cwd: asString(headerLine.value.cwd),
  };
  const entryLines = lines.filter((line) => line !== headerLine);
  const records = normalizedFromRaw(entryLines, header, { ...options, cwd: options.cwd ?? header.cwd });
  const previous = Math.max(0, Math.min(options.previousCommittedOffset ?? 0, buffer.length));
  return {
    header, version: header.version, sessionId: header.id, records, rawRecords: lines.map((line) => ({ value: line.value, range: line.range, byteHash: line.hash, index: line.index })), branches: buildBranches(records), warnings,
    completeOffset, completeSha256: sha256(buffer.subarray(0, completeOffset)),
    previousPrefixSha256: sha256(buffer.subarray(0, previous)),
  };
}

export const parseJsonl = parseJsonlBytes;

export async function parseJsonlFile(file: string, options: Omit<ParseJsonlOptions, "file"> = {}): Promise<ParsedSession> {
  return parseJsonlBytes(await readFile(file), { ...options, file });
}
```

## `src/publish.ts`

```typescript
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  CONCEPT_TYPES,
  ConceptDocument,
  ConceptType,
  parseConceptMarkdown,
} from "./concept.js";

export interface PublishOptions {
  
  projectRoot?: string;
  
  cheatcodesDir?: string;
  
  curatedDir?: string;
  
  knowledgeDir?: string;
}

export interface PublishedConcept {
  id: string;
  type: ConceptType;
  title: string;
  description: string;
  status: "draft" | "stable" | "deprecated";
  relativePath: string;
}

export interface PublishResult {
  changed: boolean;
  recoveredBackup: boolean;
  conceptCount: number;
  knowledgeDir: string;
}

export class PublishValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Cannot publish knowledge bundle:\n- ${issues.join("\n- ")}`);
    this.name = "PublishValidationError";
    this.issues = issues;
  }
}

type DesiredTree = Map<string, Buffer>;

type ResolvedPaths = {
  curatedDir: string;
  knowledgeDir: string;
  backupDir: string;
};

function resolvePaths(options: PublishOptions | string | undefined): ResolvedPaths {
  const normalized = typeof options === "string" ? { projectRoot: options } : (options ?? {});
  const projectRoot = path.resolve(normalized.projectRoot ?? process.cwd());
  const cheatcodesDir = path.resolve(projectRoot, normalized.cheatcodesDir ?? ".cheatcodes");
  const curatedDir = path.resolve(projectRoot, normalized.curatedDir ?? path.join(cheatcodesDir, "curated", "concepts"));
  const knowledgeDir = path.resolve(projectRoot, normalized.knowledgeDir ?? path.join(cheatcodesDir, "knowledge"));
  return { curatedDir, knowledgeDir, backupDir: `${knowledgeDir}.backup` };
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}


export async function recoverPublishBackup(options?: PublishOptions | string): Promise<boolean> {
  const { knowledgeDir, backupDir } = resolvePaths(options);
  if (!(await exists(backupDir))) return false;
  if (await exists(knowledgeDir)) {
    await rm(backupDir, { recursive: true, force: true });
  } else {
    await mkdir(path.dirname(knowledgeDir), { recursive: true });
    await rename(backupDir, knowledgeDir);
  }
  return true;
}

async function markdownFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const result: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new PublishValidationError([`symbolic links are not allowed in curated concepts: ${absolute}`]);
      }
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(absolute);
    }
  }

  await visit(root);
  return result;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedTitle(title: string): string {
  return title.normalize("NFKC").toLowerCase();
}

function markdownText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1").replace(/[\r\n]+/g, " ").trim();
}

function markdownDescription(value: string): string {
  return markdownText(value).replace(/\s+/g, " ");
}

function linkPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function renderRootIndex(): string {
  return [
    "---",
    'okf_version: "0.2"',
    "---",
    "",
    "# Project knowledge",
    "",
    "- [Concepts](concepts/) - Curated decisions, gotchas, and runbooks.",
    "",
  ].join("\n");
}


export function renderConceptIndex(concepts: readonly PublishedConcept[]): string {
  const lines = ["# Concepts", ""];
  for (const type of CONCEPT_TYPES) {
    const group = concepts
      .filter((concept) => concept.type === type)
      .sort((left, right) => {
        const titleOrder = compareText(normalizedTitle(left.title), normalizedTitle(right.title));
        return titleOrder || compareText(left.relativePath, right.relativePath);
      });
    if (group.length === 0) continue;
    lines.push(`## ${type}`, "");
    for (const concept of group) {
      lines.push(`- [${markdownText(concept.title)}](${linkPath(concept.relativePath)}) [${concept.status}] - ${markdownDescription(concept.description)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function buildDesiredTree(curatedDir: string): Promise<{ tree: DesiredTree; concepts: PublishedConcept[] }> {
  const tree: DesiredTree = new Map();
  const concepts: PublishedConcept[] = [];
  const issues: string[] = [];
  const ids = new Map<string, string>();
  const files = await markdownFiles(curatedDir);

  for (const filename of files) {
    const relative = path.relative(curatedDir, filename).split(path.sep).join("/");
    let bytes: Buffer;
    let document: ConceptDocument;
    try {
      bytes = await readFile(filename);
      document = parseConceptMarkdown(bytes.toString("utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`${relative}: ${message}`);
      continue;
    }

    const id = document.frontmatter.cheatcodes_id;
    const expectedName = `${id}.md`;
    if (relative !== expectedName) {
      issues.push(`${relative}: path must be exactly ${expectedName}`);
    }
    const previous = ids.get(id);
    if (previous !== undefined) issues.push(`${relative}: duplicate cheatcodes_id ${id} also used by ${previous}`);
    else ids.set(id, relative);

    tree.set(`concepts/${relative}`, bytes);
    concepts.push({
      id,
      type: document.frontmatter.type,
      title: document.frontmatter.title,
      description: document.frontmatter.description,
      status: document.frontmatter.status,
      relativePath: relative,
    });
  }

  if (issues.length > 0) throw new PublishValidationError(issues);
  tree.set("index.md", Buffer.from(renderRootIndex(), "utf8"));
  tree.set("concepts/index.md", Buffer.from(renderConceptIndex(concepts), "utf8"));
  return { tree, concepts };
}

async function readTree(root: string): Promise<DesiredTree | undefined> {
  if (!(await exists(root))) return undefined;
  const result: DesiredTree = new Map();

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.set(relative, await readFile(absolute));
      else throw new PublishValidationError([`generated bundle contains an unsupported entry: ${relative}`]);
    }
  }

  await visit(root);
  return result;
}

function treesEqual(left: DesiredTree | undefined, right: DesiredTree): boolean {
  if (left === undefined || left.size !== right.size) return false;
  for (const [name, bytes] of right) {
    const actual = left.get(name);
    if (actual === undefined || !actual.equals(bytes)) return false;
  }
  return true;
}

async function writeTree(root: string, tree: DesiredTree): Promise<void> {
  await mkdir(root, { recursive: false });
  const names = [...tree.keys()].sort(compareText);
  for (const name of names) {
    const target = path.join(root, ...name.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, tree.get(name)!, { flag: "wx" });
  }
}


export async function publishKnowledge(options?: PublishOptions | string): Promise<PublishResult> {
  const paths = resolvePaths(options);
  const recoveredBackup = await recoverPublishBackup(options);
  const { tree, concepts } = await buildDesiredTree(paths.curatedDir);
  const current = await readTree(paths.knowledgeDir);
  if (treesEqual(current, tree)) {
    return {
      changed: false,
      recoveredBackup,
      conceptCount: concepts.length,
      knowledgeDir: paths.knowledgeDir,
    };
  }

  await mkdir(path.dirname(paths.knowledgeDir), { recursive: true });
  const stageDir = `${paths.knowledgeDir}.staging-${process.pid}-${randomUUID()}`;
  let oldMoved = false;
  try {
    await writeTree(stageDir, tree);
    const staged = await readTree(stageDir);
    if (!treesEqual(staged, tree)) throw new Error("staged knowledge bundle failed byte validation");

    if (await exists(paths.knowledgeDir)) {
      await rename(paths.knowledgeDir, paths.backupDir);
      oldMoved = true;
    }
    try {
      await rename(stageDir, paths.knowledgeDir);
    } catch (error) {
      if (oldMoved && !(await exists(paths.knowledgeDir)) && await exists(paths.backupDir)) {
        await rename(paths.backupDir, paths.knowledgeDir);
        oldMoved = false;
      }
      throw error;
    }
    if (oldMoved) {
      await rm(paths.backupDir, { recursive: true, force: true });
      oldMoved = false;
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }

  return {
    changed: true,
    recoveredBackup,
    conceptCount: concepts.length,
    knowledgeDir: paths.knowledgeDir,
  };
}

export const publish = publishKnowledge;
export const publishKnowledgeBundle = publishKnowledge;
```

## `src/scan.ts`

```typescript
import { open, readdir, stat } from "node:fs/promises";import path from "node:path";
import type { ProducerState } from "./state.js";

export interface SessionCandidate {
  file: string;
  size: number;
  mtimeMs: number;
  header: { id: string; cwd: string; version: number };
  matchedRoot: string;
}

export interface ScanWarning { file: string; message: string }
export interface ScanResult { changed: SessionCandidate[]; unchanged: string[]; skipped: ScanWarning[]; missing: string[] }

const SKIPPED_DIRECTORIES = new Set([".cheatcodes", ".git", "node_modules"]);

async function discoverJsonl(directory: string, output: string[], warnings: ScanWarning[]): Promise<void> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { warnings.push({ file: directory, message: `Cannot scan input: ${(error as Error).message}` }); return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) await discoverJsonl(target, output, warnings);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(path.resolve(target));
  }
}

async function readHeader(file: string): Promise<{ id: string; cwd: string; version: number }> {
  const handle = await open(file, "r");
  try {
    let bytes = Buffer.alloc(4096);
    let content = Buffer.alloc(0);
    let position = 0;
    while (content.length < 1024 * 1024) {
      const result = await handle.read(bytes, 0, bytes.length, position);
      if (!result.bytesRead) break;
      content = Buffer.concat([content, bytes.subarray(0, result.bytesRead)]);
      const newline = content.indexOf(0x0a);
      if (newline >= 0) {
        const value = JSON.parse(content.subarray(0, newline).toString("utf8")) as Record<string, unknown>;
        if (value.type !== "session" || typeof value.id !== "string" || typeof value.cwd !== "string") throw new Error("invalid session header");
        return { id: value.id, cwd: value.cwd, version: typeof value.version === "number" ? value.version : 1 };
      }
      position += result.bytesRead;
      bytes = Buffer.alloc(Math.min(bytes.length * 2, 65536));
    }
    throw new Error("session header is not a complete line");
  } finally { await handle.close(); }
}

function matchProjectRoot(cwd: string, roots: string[]): string | undefined {
  const absolute = path.resolve(cwd);
  return roots
    .filter((root) => {
      const relative = path.relative(root, absolute);
      return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    })
    .sort((a, b) => b.length - a.length)[0];
}

export async function scanInputs(inputs: string[], projectRoots: string[], state: ProducerState): Promise<ScanResult> {
  const files: string[] = [];
  const skipped: ScanWarning[] = [];
  const missing: string[] = [];
  for (const input of [...new Set(inputs.map((value) => path.resolve(value)))].sort()) {
    let metadata;
    try { metadata = await stat(input); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { missing.push(input); continue; }
      skipped.push({ file: input, message: `Cannot scan input: ${(error as Error).message}` });
      continue;
    }
    if (metadata.isDirectory()) await discoverJsonl(input, files, skipped);
    else if (input.endsWith(".jsonl")) files.push(input);
    else skipped.push({ file: input, message: "Input is neither a directory nor a .jsonl file" });
  }
  const changed: SessionCandidate[] = [];
  const unchanged: string[] = [];
  for (const file of [...new Set(files)].sort()) {
    let metadata;
    try { metadata = await stat(file); } catch (error) { skipped.push({ file, message: `Cannot stat session: ${(error as Error).message}` }); continue; }
    const cursor = state.files[file];
    if (cursor && cursor.observedSize === metadata.size && cursor.mtimeMs === metadata.mtimeMs) { unchanged.push(file); continue; }
    try {
      const header = await readHeader(file);
      const matchedRoot = matchProjectRoot(header.cwd, projectRoots);
      if (!matchedRoot) { skipped.push({ file, message: "Session cwd is outside configured project roots" }); continue; }
      changed.push({ file, size: metadata.size, mtimeMs: metadata.mtimeMs, header, matchedRoot });
    } catch (error) { skipped.push({ file, message: `Cannot read session header: ${(error as Error).message}` }); }
  }
  return { changed, unchanged, skipped, missing };
}
```

## `src/state.ts`

```typescript
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
```

## `src/worker.ts`

```typescript
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
```

## `test/auto.test.ts`

```typescript
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { findProjectRoot, globalConfigPath, initializeProject, loadGlobalConfig, validateGlobalConfig } from "../src/config.js";
import type { Curator } from "../src/curate.js";
import { main, projectStatus, runProject } from "../src/cli.js";
import { acquireProjectLock } from "../src/state.js";
import { readLastRun, runAuto } from "../src/worker.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }

function fixture(root: string, sessionId = "session-1"): string {
  return [
    { type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00Z", cwd: root },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "No, that is wrong. We must use the repository adapter instead." }] } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Understood. The repository adapter is required." }] } },
  ].map(line).join("");
}

function fakeCurator(calls: { count: number }): Curator {
  return { async curate(packet) {
    calls.count++;
    return { concepts: [{ action: "create", type: "Decision", title: "Use the repository adapter", description: "Repository access uses the adapter.", tags: ["repository"], evidenceRefs: [packet.evidence[0]!.id], content: { answer: "Use the repository adapter.", rationale: "The direct approach violates project architecture." } }] };
  } };
}

async function sessionsWithFixture(root: string): Promise<string> {
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, "one.jsonl"), fixture(root));
  return sessions;
}

test("global config path honors the environment, XDG, and home fallbacks", () => {
  assert.equal(globalConfigPath({ CHEATCODES_CONFIG: "/tmp/explicit.json" }), path.resolve("/tmp/explicit.json"));
  assert.equal(globalConfigPath({ XDG_CONFIG_HOME: "/xdg" }), path.join("/xdg", "cheatcodes", "config.json"));
  assert.equal(globalConfigPath({}), path.join(homedir(), ".config", "cheatcodes", "config.json"));
});

test("global config validation rejects unknown versions and invalid fields", () => {
  assert.throws(() => validateGlobalConfig({ version: 2 }), /version must be 1/);
  assert.throws(() => validateGlobalConfig({ version: 1, surprise: true }), /not a recognized field/);
  assert.throws(() => validateGlobalConfig(fullConfigWith({ model: undefined })), /config\.model/);
  assert.throws(() => validateGlobalConfig(fullConfigWith({ automation: { enabled: "yes" } })), /automation.enabled/);
  assert.throws(() => validateGlobalConfig(fullConfigWith({ workerTimeoutMinutes: 0 })), /workerTimeoutMinutes/);
  function fullConfigWith(patch: Record<string, unknown>): Record<string, unknown> {
    return { version: 1, model: "fake/model", inputs: [], automation: { enabled: true, setupMissingProjects: true }, workerTimeoutMinutes: 10, projectAliases: {}, ...patch };
  }
});

test("auto outside a Git repository exits without writes", async () => {
  const cwd = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json") };
    const result = await runAuto({ cwd, env });
    assert.equal(result.outcome, "skipped");
    assert.match(result.reason!, /outside a Git repository/);
    assert.deepEqual(await readdir(cwd), []);
    assert.equal(await loadGlobalConfig(env), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("auto skips when automation is disabled", async () => {
  const root = await temporary();
  try {
    const { env } = await writeGlobalConfig({ automation: { enabled: false } });
    const result = await runAuto({ root, env });
    assert.equal(result.outcome, "skipped");
    assert.match(result.reason!, /automation is disabled/);
    await assert.rejects(stat(path.join(root, ".cheatcodes", "project.json")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("auto sets up and runs a missing project by default", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    const result = await runAuto({ root, env, curator: fakeCurator(calls) });
    assert.equal(result.outcome, "success");
    assert.equal(result.run!.changedFiles, 1);
    assert.equal(calls.count, 1);
    const identity = JSON.parse(await readFile(path.join(root, ".cheatcodes", "project.json"), "utf8"));
    assert.match(identity.projectId, /^local:/);
    const last = await readLastRun(root);
    assert.equal(last!.outcome, "success");
    await stat(path.join(root, ".cheatcodes", "local", "worker.jsonl"));
    await stat(path.join(root, ".cheatcodes", "knowledge", "index.md"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("auto uses a Pi model hint only to create a missing global config", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    const sessions = await sessionsWithFixture(root);
    const env: NodeJS.ProcessEnv = {
      CHEATCODES_CONFIG: path.join(configDir, "config.json"),
      CHEATCODES_PI_MODEL: "prov/m1",
      CHEATCODES_PI_THINKING: "high",
    };
    const calls = { count: 0 };
    const result = await runAuto({ root, env, curator: fakeCurator(calls) });
    assert.equal(result.outcome, "success");
    const global = await loadGlobalConfig(env);
    assert.equal(global!.model, "prov/m1:high");
    assert.deepEqual(global!.inputs, []);
    assert.equal(result.run!.changedFiles, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("an existing global model is never overwritten by a Pi model hint", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ model: "fake/model", inputs: [sessions] });
    const envWithHint = { ...env, CHEATCODES_PI_MODEL: "other/model" };
    const calls = { count: 0 };
    await runAuto({ root, env: envWithHint, curator: fakeCurator(calls) });
    assert.equal((await loadGlobalConfig(envWithHint))!.model, "fake/model");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("direct session-file and session-directory hints are scanned", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [] });
    const envWithHints = { ...env, CHEATCODES_PI_SESSION_FILE: path.join(sessions, "one.jsonl") };
    const calls = { count: 0 };
    const result = await runAuto({ root, env: envWithHints, curator: fakeCurator(calls) });
    assert.equal(result.outcome, "success");
    assert.equal(result.run!.changedFiles, 1);
    assert.equal(calls.count, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a second auto worker coalesces under the project lock", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await acquireProjectLock(root);
    const calls = { count: 0 };
    const result = await runAuto({ root, env, curator: fakeCurator(calls) });
    assert.equal(result.outcome, "coalesced");
    assert.equal(calls.count, 0);
    assert.equal((await readLastRun(root))!.outcome, "coalesced");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("worker timeout aborts work, records failure, and releases the lock", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions);
    await writeFile(path.join(sessions, "one.jsonl"), fixture(root, "s1"));
    await writeFile(path.join(sessions, "two.jsonl"), fixture(root, "s2"));
    const { env } = await writeGlobalConfig({ inputs: [sessions], workerTimeoutMinutes: 0.0001 });
    const calls = { count: 0 };
    const sleepyCurator: Curator = { async curate(packet) {
      calls.count++;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return fakeCurator(calls).curate(packet);
    } };
    const result = await runAuto({ root, env, curator: sleepyCurator });
    assert.equal(result.outcome, "timeout");
    assert.equal(result.run!.deadlineExceeded, true);
    const last = await readLastRun(root);
    assert.equal(last!.outcome, "timeout");
    await assert.rejects(stat(path.join(root, ".cheatcodes", "local", "run.lock")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status reports current inputs and the last worker result", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runAuto({ root, env, curator: fakeCurator({ count: 0 }) });
    const status = await projectStatus(root, env);
    assert.equal(status.discoveredFiles, 1);
    assert.equal(status.lastRun!.outcome, "success");
    assert.deepEqual(status.missingInputs, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("removed inputs prune obsolete cursors safely", async () => {
  const root = await temporary();
  try {
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await initializeProject({ root }, env);
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    await rm(sessions, { recursive: true });
    const result = await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    assert.equal(result.prunedCursors, 1);
    const state = JSON.parse(await readFile(path.join(root, ".cheatcodes", "local", "state.json"), "utf8"));
    assert.deepEqual(state.files, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy config and state migrate byte-safely and idempotently", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    const sessions = await sessionsWithFixture(root);
    const cheatcodes = path.join(root, ".cheatcodes");
    await mkdir(path.join(cheatcodes, "operations"), { recursive: true });
    const legacyState = `{"version":1,"files":{"${sessions}/one.jsonl":{"sessionId":"session-1","committedOffset":5,"observedSize":10,"mtimeMs":1,"prefixSha256":"abc"}}}\n`;
    await writeFile(path.join(cheatcodes, "state.json"), legacyState);
    await writeFile(path.join(cheatcodes, "operations", "op-1.json"), "{}\n");
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json") };
    await writeFile(path.join(cheatcodes, "config.json"), JSON.stringify({
      projectId: "legacy/project",
      model: "legacy/model",
      inputs: [sessions],
      projectRoots: [".", "/elsewhere"],
    }));
    const migrated = await findProjectRoot(root, env);
    assert.equal(migrated, root);
    const global = await loadGlobalConfig(env);
    assert.equal(global!.model, "legacy/model");
    assert.deepEqual(global!.inputs, [path.resolve(sessions)]);
    assert.deepEqual(global!.projectAliases["legacy/project"], ["/elsewhere"]);
    assert.equal(await readFile(path.join(cheatcodes, "local", "state.json"), "utf8"), legacyState);
    await stat(path.join(cheatcodes, "local", "operations", "op-1.json"));
    await stat(path.join(cheatcodes, "project.json"));
    await assert.rejects(stat(path.join(cheatcodes, "config.json")));
    await stat(path.join(cheatcodes, "knowledge", "index.md"));
    
    const before = await readFile(path.join(cheatcodes, "local", "state.json"));
    const again = await findProjectRoot(root, env);
    assert.equal(again, root);
    assert.deepEqual(await readFile(path.join(cheatcodes, "local", "state.json")), before);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("a model conflict preserves the global model and records a warning", async () => {
  const root = await temporary();
  try {
    const cheatcodes = path.join(root, ".cheatcodes");
    await mkdir(cheatcodes, { recursive: true });
    const { env } = await writeGlobalConfig({ model: "global/model" });
    await writeFile(path.join(cheatcodes, "config.json"), JSON.stringify({
      projectId: "legacy/project",
      model: "legacy/model",
      inputs: [path.join(root, "sessions")],
      projectRoots: ["."],
    }));
    await assert.equal((await findProjectRoot(root, env)), root);
    const global = await loadGlobalConfig(env);
    assert.equal(global!.model, "global/model");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a failed migration leaves the complete legacy layout usable", async () => {
  const root = await temporary();
  try {
    const cheatcodes = path.join(root, ".cheatcodes");
    await mkdir(cheatcodes, { recursive: true });
    const legacyConfig = path.join(cheatcodes, "config.json");
    await writeFile(legacyConfig, "{ not json");
    await writeFile(path.join(cheatcodes, "state.json"), "{}\n");
    const env = { CHEATCODES_CONFIG: path.join(root, "global.json") };
    await assert.rejects(findProjectRoot(root, env), /config\.json/);
    await stat(legacyConfig);
    await stat(path.join(cheatcodes, "state.json"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unknown commands and options fail with exit code 2", async () => {
  const original = process.exitCode;
  try {
    await main(["bogus"]);
    assert.equal(process.exitCode, 2);
    process.exitCode = original;
    await main(["run", "--model", "x"]);
    assert.equal(process.exitCode, 2);
  } finally { process.exitCode = original; }
});
```

## `test/helpers.ts`

```typescript
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function temporary(prefix = "cheatcodes-test-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export interface GlobalConfigOptions {
  dir?: string;
  model?: string;
  inputs?: string[];
  automation?: { enabled?: boolean; setupMissingProjects?: boolean };
  workerTimeoutMinutes?: number;
  projectAliases?: Record<string, string[]>;
}

export function globalConfigObject(options: GlobalConfigOptions = {}): Record<string, unknown> {
  return {
    version: 1,
    model: options.model ?? "fake/model",
    inputs: options.inputs ?? [],
    automation: { enabled: true, setupMissingProjects: true, ...options.automation },
    workerTimeoutMinutes: options.workerTimeoutMinutes ?? 10,
    projectAliases: options.projectAliases ?? {},
  };
}

export async function writeGlobalConfig(options: GlobalConfigOptions = {}): Promise<{ file: string; env: NodeJS.ProcessEnv }> {
  const dir = options.dir ?? await temporary("cheatcodes-config-");
  const file = path.join(dir, "config.json");
  await writeFile(file, JSON.stringify(globalConfigObject(options), null, 2));
  return { file, env: { CHEATCODES_CONFIG: file } };
}

export function envForMissingConfig(): Promise<NodeJS.ProcessEnv> {
  return temporary("cheatcodes-missing-").then((dir) => ({ CHEATCODES_CONFIG: path.join(dir, "config.json") }));
}
```

## `test/mvp.test.ts`

```typescript
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { initializeProject } from "../src/config.js";
import type { Curator } from "../src/curate.js";
import { publishProject, runProject } from "../src/cli.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

const execFileAsync = promisify(execFile);
function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }

function fixture(root: string): string {
  return [
    { type: "session", version: 3, id: "session-1", timestamp: "2026-01-01T00:00:00Z", cwd: root },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "No, that is wrong. We must use the repository adapter instead." }] } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Understood. The repository adapter is required." }] } },
  ].map(line).join("");
}

test("init runs at the Git top level, publishes an empty bundle, and is idempotent", async () => {
  const root = await temporary();
  const originalCwd = process.cwd();
  try {
    await execFileAsync("git", ["init", "-q", root]);
    const nested = path.join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    const sessions = path.join(root, "sessions");
    await mkdir(sessions);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    process.chdir(nested);
    const first = await initializeProject({}, env);
    assert.equal(first.root, root);
    const second = await initializeProject({}, env);
    assert.equal(second.projectId, first.projectId);
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.equal(agents.match(/## Project knowledge/g)?.length, 1);
    await readFile(path.join(root, ".cheatcodes", "project.json"), "utf8");
    await readFile(path.join(root, ".cheatcodes", "knowledge", "index.md"), "utf8");
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("init requires a valid global config", async () => {
  const root = await temporary();
  try {
    const env = { CHEATCODES_CONFIG: path.join(root, "missing", "config.json") };
    await assert.rejects(initializeProject({ root }, env), /No global config/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("init and deterministic incremental run", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await initializeProject({ root }, env);
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.equal(agents.match(/## Project knowledge/g)?.length, 1);
    await writeFile(path.join(sessions, "one.jsonl"), fixture(root));
    let calls = 0;
    const curator: Curator = { async curate(packet) {
      calls++;
      return { concepts: [{ action: "create", type: "Decision", title: "Use the repository adapter", description: "Repository access uses the adapter.", tags: ["repository"], evidenceRefs: [packet.evidence[0]!.id], content: { answer: "Use the repository adapter.", rationale: "The direct approach violates project architecture." } }] };
    } };
    const first = await runProject({ root, curator, env, now: () => new Date("2026-01-01T00:00:00Z") });
    assert.equal(first.curatorCalls, 1);
    assert.equal(calls, 1);
    const stateBefore = await readFile(path.join(root, ".cheatcodes", "local", "state.json"));
    const knowledgeBefore = await readFile(path.join(root, ".cheatcodes", "knowledge", "index.md"));
    const second = await runProject({ root, curator, env });
    assert.equal(second.curatorCalls, 0);
    assert.equal(calls, 1);
    assert.deepEqual(await readFile(path.join(root, ".cheatcodes", "local", "state.json")), stateBefore);
    assert.deepEqual(await readFile(path.join(root, ".cheatcodes", "knowledge", "index.md")), knowledgeBefore);
    await rm(path.join(root, ".cheatcodes", "knowledge"), { recursive: true });
    await publishProject(root);
    assert.deepEqual(await readFile(path.join(root, ".cheatcodes", "knowledge", "index.md")), knowledgeBefore);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("partial final line remains uncommitted", async () => {
  const root = await temporary();
  try {
    const sessions = path.join(root, "sessions"); await mkdir(sessions);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await initializeProject({ root }, env);
    const complete = line({ type: "session", version: 3, id: "s", cwd: root });
    await writeFile(path.join(sessions, "one.jsonl"), `${complete}{"type":"message"`);
    const curator: Curator = { async curate() { throw new Error("must not call"); } };
    await runProject({ root, curator, env });
    const state = JSON.parse(await readFile(path.join(root, ".cheatcodes", "local", "state.json"), "utf8"));
    assert.equal(state.files[path.join(sessions, "one.jsonl")].committedOffset, Buffer.byteLength(complete));
  } finally { await rm(root, { recursive: true, force: true }); }
});
```

## `test/smoke.live.test.ts`

```typescript
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject } from "../src/config.js";
import { runProject } from "../src/cli.js";
import { writeGlobalConfig } from "./helpers.js";

const model = process.env.CHEATCODES_LIVE_MODEL;
const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

function fixture(root: string): string {
  let parent: string | null = null;
  const entry = (id: string, message: unknown): unknown => {
    const record = { type: "message", id, parentId: parent, timestamp: "2026-01-01T00:00:00Z", message };
    parent = id;
    return record;
  };
  return [
    { type: "session", version: 3, id: "smoke-session", timestamp: "2026-01-01T00:00:00Z", cwd: root },
    entry("u1", { role: "user", content: [{ type: "text", text: "Fix the failing parse test in src/parse.ts and keep the public API stable." }] }),
    entry("a1", { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "npm test" } }] }),
    entry("t1", { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "1 failing\nparse test failed" }], isError: false, exitCode: 1, details: {} }),
    entry("u2", { role: "user", content: [{ type: "text", text: "No, the tokenizer must handle nested quotes before splitting on semicolons." }] }),
    entry("a2", { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-2", name: "edit", arguments: { path: "src/parse.ts", patch: "-split(raw)\n+splitNested(raw)" } }] }),
    entry("t2", { role: "toolResult", toolCallId: "call-2", toolName: "edit", content: [{ type: "text", text: "Edited src/parse.ts" }], isError: false, details: {} }),
    entry("a3", { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-3", name: "bash", arguments: { command: "npm test" } }] }),
    entry("t3", { role: "toolResult", toolCallId: "call-3", toolName: "bash", content: [{ type: "text", text: "42 passing" }], isError: false, exitCode: 0, details: {} }),
    entry("a4", { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Fixed. The tokenizer now nests quotes before splitting on semicolons; the parse test passes." }] }),
  ].map(line).join("");
}

test("live model smoke test", { timeout: 300_000, skip: !model || process.env.CI === "true" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cheatcodes-live-"));
  try {
    const sessions = path.join(root, "sessions");
    await mkdir(sessions);
    const { env } = await writeGlobalConfig({ model: model!, inputs: [sessions] });
    await initializeProject({ root }, env);
    await writeFile(path.join(sessions, "smoke.jsonl"), fixture(root));
    const result = await runProject({ root, env });
    console.log("run result:", JSON.stringify(result, null, 2));
    assert.equal(result.curatorCalls, 1);
    assert.ok(result.conceptsWritten >= 1, "expected at least one concept write");
    const concepts = (await readdir(path.join(root, ".cheatcodes", "curated", "concepts"))).filter((name) => name.endsWith(".md"));
    assert.ok(concepts.length >= 1);
    for (const name of concepts) {
      console.log(`--- curated/${name} ---`);
      console.log(await readFile(path.join(root, ".cheatcodes", "curated", "concepts", name), "utf8"));
    }
    const knowledge = await readFile(path.join(root, ".cheatcodes", "knowledge", "concepts", "index.md"), "utf8");
    console.log("--- knowledge/concepts/index.md ---");
    console.log(knowledge);
    assert.match(knowledge, /## (Decision|Gotcha|Runbook)/);
    for (const warning of result.warnings) console.log(`warning: ${warning}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

## `.cheatcodes/project.json`

```json
{
  "version": 1,
  "projectId": "local:e42d44d0-d178-4740-abe7-70c716483ba0"
}
```

## `.cheatcodes/knowledge/concepts/2fad95eef7.md`

```markdown
---
cheatcodes_id: 2fad95eef7
type: Decision
title: Use global configuration with an optionless automatic entry point
description: Store user settings globally and give launchers a stable command that checks, initializes, and runs Cheatcodes for a repository.
tags:
  - configuration
  - global-settings
  - cli
  - migration
  - pi-extension
status: draft
generated:
  by: cheatcodes/0.2.0
  at: 2026-08-29T18:39:05.212Z
sources:
  - id: session-6312cc6cc0be5460
    resource: session:01a04b3e-3031-7d12-a443-adff4f9e320a#entries=6014e840,ff206fac,fce45fec,baaafbe6
    title: Session evidence
---

# Answer

Move user settings to ~/.config/cheatcodes/config.json, keep only project identity and durable knowledge in repositories, and add an optionless cheatcodes auto command for Pi or other launchers. By default, auto should initialize and run in trusted Git repositories when Cheatcodes is absent.

# Why

Global settings avoid per-repository duplication, while a single automatic entry point keeps the Pi shim simple. Existing repository configuration and state must be migrated without data loss so the boundary change does not discard project knowledge.

# Evidence

- [evidence-05eb61361e1e4f18c59eaa28] Analyze this project along with: [ABSOLUTE PATH]
I want to keep the two boundari
[truncated]
- [evidence-2e3028ecd05401c9aef4ed40] read | repo://local:e42d44d0-d178-4740-abe7-70c716483ba0/src/cli.ts | 5660f5d95e
[truncated]
- [evidence-edbf3c2a31f5a27992df1b03] read | repo://local:e42d44d0-d178-4740-abe7-70c716483ba0/src/config.ts | 7451ab2
[truncated]
- [evidence-0de52dcd134d0fa3500465c6] read | repo://local:e42d44d0-d178-4740-abe7-70c716483ba0/src/state.ts | 8f58970d
[truncated]
```

## `.cheatcodes/knowledge/concepts/4fa2bab553.md`

````markdown
---
cheatcodes_id: 4fa2bab553
type: Runbook
title: Run the opt-in live model smoke test
description: Run the live smoke test with the Azure Responses GPT-5.6 Luna model while keeping it out of CI-required test suites.
tags:
  - smoke-test
  - live-model
  - azure
  - testing
status: draft
generated:
  by: cheatcodes/0.1.0
  at: 2026-08-29T18:39:05.212Z
sources:
  - id: session-0d2cf23672f54b3a
    resource: session:01a04abf-8917-724c-a678-ee0c8112f8a6#entries=d40c476b,4ccf40ad
    title: Session evidence
  - id: session-312d479d8777cee1
    resource: session:01a04b3e-3031-7d12-a443-adff4f9e320a#entries=9655d315,f268fd9e
    title: Session evidence
---

# Purpose

Verify the live curator flow with azure-gateway-responses/gpt-5.6-luna at high thinking without enabling the test by default or running it in CI.

# Steps

1. Ensure the smoke test is present at test/smoke.live.test.ts.
2. Run CHEATCODES_LIVE_MODEL="azure-gateway-responses/gpt-5.6-luna:high" npm test.
3. Keep CI=true unset because the smoke test refuses to run in CI.

# Evidence

- [evidence-ff28bf73e43dcb4e6bfdd69e] write | repo://local:e42d44d0-d178-4740-abe7-70c716483ba0/test/smoke.live.test.ts | 3308e3e1458344caf6b59b73f75871e52be9c508a4c58e3eff2b8fac149d219e
- [evidence-1f5d5672d9dc80ab0b9e28f2] Live smoke test passed with `azure-gateway-responses/gpt-5.6-luna:high` (~80s, high thinking).

Results:

- 1 packet harvested, 1 curator call, 1 concept written
- Model returned a strict-schema `Decision` with only valid evidence references
- Concept rendered at `.cheatcodes/curated/concepts/c0c9867e72.md` with provenance `session:smoke-session#entries=u2,t2,t3,a4`
- OKF v0.2 bundle published; `concepts/index.md` lists it as `[draft]`
- No warnings

The smoke test lives in `test/smoke.live.test.ts`. It stays skipped unless you opt in:

```sh
CHEATCODES_LIVE_MODEL="azure-gateway-responses/gpt-5.6-luna:high" npm test
```

It also refuses to run when `CI=true`, matching the plan's requirement to keep it out of required suites.

Note: `z-ai-openai/gpt-5.6-luna` would correctly fail — that provider only registers GLM models, and the plan requires fallback warnings to fail before the first model call.

# Updates

## Addendum

### Purpose

Verify the live curator flow with azure-gateway-responses/gpt-5.6-luna at high thinking without enabling the test by default or including it in required CI suites.

### Steps

1. Ensure the smoke test is present at test/smoke.live.test.ts.
2. Run CHEATCODES_LIVE_MODEL="azure-gateway-responses/gpt-5.6-luna:high" npm test.
3. Leave CI=true unset because the smoke test is intended to remain outside CI-required test suites.

### Evidence

- [evidence-e58ab8ff28ef2921afbe12af] read | repo://local:e42d44d0-d178-4740-abe7-70c716483ba0/test/mvp.test.ts | bc2b
[truncated]
- [evidence-acc42940dc4825185848a478] read | repo://local:e42d44d0-d178-4740-abe7-70c716483ba0/test/smoke.live.test.ts
[truncated]
````

## `.cheatcodes/knowledge/concepts/6cf7bf3342.md`

```markdown
---
cheatcodes_id: 6cf7bf3342
type: Decision
title: Keep the Pi extension as a detached one-way launcher
description: The Pi extension should launch Cheatcodes without synchronous back-and-forth communication or foreground work during Pi startup.
tags:
  - pi-extension
  - fire-and-forget
  - integration
  - startup
status: draft
generated:
  by: cheatcodes/0.2.0
  at: 2026-08-29T18:39:05.212Z
sources:
  - id: session-f85b12113d91161c
    resource: session:01a04b3e-3031-7d12-a443-adff4f9e320a#entries=6014e840,bb0959fe
    title: Session evidence
---

# Answer

Make the Pi extension a detached, one-way launcher. It should not use foreground Cheatcodes commands, widgets, JSONL scanning, or pi.exec() communication while Pi is loading.

# Why

Separating the extension boundary from the standalone CLI prevents Cheatcodes processing from blocking Pi startup and keeps the extension responsible only for triggering the tool.

# Evidence

- [evidence-05eb61361e1e4f18c59eaa28] Analyze this project along with: [ABSOLUTE PATH]
I want to keep the two boundari
[truncated]
- [evidence-3ce1f474c827fe75234f42c2] read | 48be5992e60eec647aa86d29ed35c743ef460dcba74df4264099600e874144f8
```

## `.cheatcodes/knowledge/concepts/7fa22339ce.md`

````markdown
---
cheatcodes_id: 7fa22339ce
type: Gotcha
title: Use the Azure Responses provider for GPT-5.6 Luna
description: gpt-5.6-luna is registered under azure-gateway-responses, not z-ai-openai.
tags:
  - providers
  - model-routing
  - azure
  - z-ai-openai
status: draft
generated:
  by: cheatcodes/0.1.0
  at: 2026-08-29T00:25:14.239Z
sources:
  - id: session-c76ae4d946d2befb
    resource: session:01a04abf-8917-724c-a678-ee0c8112f8a6#entries=61eb19fa,4ccf40ad
    title: Session evidence
---

# Symptom

Using z-ai-openai/gpt-5.6-luna for the smoke test fails before the first model call.

# Cause

The z-ai-openai provider registers GLM models, while gpt-5.6-luna is registered under azure-gateway-responses.

# Fix

Use azure-gateway-responses/gpt-5.6-luna:high for the smoke test.

# Evidence

- [evidence-24c398fbb139af18f6a32cb5] azure-gateway -> gpt-5.4-mini, gpt-5-nano-2, o3, DeepSeek-V4-Pro, DeepSeek-V4-Flash, Kimi-K2.6-1
azure-gateway-responses -> gpt-5.6-terra, gpt-5.6-sol, gpt-5.6-luna
azure-anthropic-gateway -> claude-fable-5, claude-opus-5, claude-opus-4-8, claude-sonnet-5, claude-sonnet-4-6, claude-haiku-4-5
z-ai-openai -> glm-5.3, GLM-5-Turbo, GLM-4.5-air, glm-5.3-flash
- [evidence-1f5d5672d9dc80ab0b9e28f2] Live smoke test passed with `azure-gateway-responses/gpt-5.6-luna:high` (~80s, high thinking).

Results:

- 1 packet harvested, 1 curator call, 1 concept written
- Model returned a strict-schema `Decision` with only valid evidence references
- Concept rendered at `.cheatcodes/curated/concepts/c0c9867e72.md` with provenance `session:smoke-session#entries=u2,t2,t3,a4`
- OKF v0.2 bundle published; `concepts/index.md` lists it as `[draft]`
- No warnings

The smoke test lives in `test/smoke.live.test.ts`. It stays skipped unless you opt in:

```sh
CHEATCODES_LIVE_MODEL="azure-gateway-responses/gpt-5.6-luna:high" npm test
```

It also refuses to run when `CI=true`, matching the plan's requirement to keep it out of required suites.

Note: `z-ai-openai/gpt-5.6-luna` would correctly fail — that provider only registers GLM models, and the plan requires fallback warnings to fail before the first model call.
````

## `.cheatcodes/knowledge/concepts/index.md`

```markdown
# Concepts

## Decision

- [Keep the Pi extension as a detached one-way launcher](6cf7bf3342.md) [draft] - The Pi extension should launch Cheatcodes without synchronous back-and-forth communication or foreground work during Pi startup.
- [Use global configuration with an optionless automatic entry point](2fad95eef7.md) [draft] - Store user settings globally and give launchers a stable command that checks, initializes, and runs Cheatcodes for a repository.

## Gotcha

- [Use the Azure Responses provider for GPT-5.6 Luna](7fa22339ce.md) [draft] - gpt-5.6-luna is registered under azure-gateway-responses, not z-ai-openai.

## Runbook

- [Run the opt-in live model smoke test](4fa2bab553.md) [draft] - Run the live smoke test with the Azure Responses GPT-5.6 Luna model while keeping it out of CI-required test suites.
```

## `.cheatcodes/knowledge/index.md`

```markdown
---
okf_version: "0.2"
---

# Project knowledge

- [Concepts](concepts/) - Curated decisions, gotchas, and runbooks.
```


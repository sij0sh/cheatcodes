# cheat-codes - source bundle

- generated: 2026-08-30T15:45:37+00:00
- files: 17
- total: 3,044 lines / 134,803 bytes
- scope: repo source + cheat-codes knowledge base (no node_modules, no dist, no package-lock, no curated duplicates, no local runtime state)

## contents

| file | lines | bytes | sha256 |
| --- | ---: | ---: | --- |
| [package.json](#packagejson) | 37 | 811 | `2a30fe0105ded407` |
| [tsconfig.json](#tsconfigjson) | 16 | 328 | `4bd34f3354b2d186` |
| [AGENTS.md](#AGENTSmd) | 4 | 60 | `a241fb21f4fb060c` |
| [src/cli.ts](#srcclits) | 55 | 2,387 | `ba1ade366c2a03b2` |
| [src/concept.ts](#srcconceptts) | 284 | 10,401 | `68fe600ac6f2c178` |
| [src/config.ts](#srcconfigts) | 213 | 9,351 | `92f2c6e27229f0e6` |
| [src/curate.ts](#srccuratets) | 141 | 6,981 | `cb0a81805651cf5e` |
| [src/harvest.ts](#srcharvestts) | 251 | 11,327 | `4bc948331127ea94` |
| [src/jsonl.ts](#srcjsonlts) | 374 | 17,590 | `301705b84ff2efd6` |
| [src/run.ts](#srcrunts) | 351 | 14,625 | `fe2e36866a68e6a2` |
| [src/scan.ts](#srcscants) | 92 | 4,514 | `68af177190844dc0` |
| [src/state.ts](#srcstatets) | 261 | 9,897 | `2cda69e1ec2d5a51` |
| [test/auto.test.ts](#testautotestts) | 399 | 20,049 | `c59ac7be32b4390c` |
| [test/concept.test.ts](#testconcepttestts) | 209 | 8,056 | `8310953589272d74` |
| [test/helpers.ts](#testhelpersts) | 37 | 1,409 | `47f6c0f04d32ca79` |
| [test/live/smoke.live.test.ts](#testlivesmokelivetestts) | 57 | 3,608 | `15db7dab94509d2a` |
| [test/mvp.test.ts](#testmvptestts) | 263 | 13,409 | `e0f1cff0141ab32e` |

## `package.json`

```json
{
  "name": "cheatcodes",
  "version": "0.2.0",
  "description": "Standalone coding-agent knowledge harvester and curator CLI.",
  "type": "module",
  "bin": {
    "cheatcodes": "dist/cli.js"
  },
  "exports": {
    ".": "./dist/cli.js",
    "./cli": "./dist/cli.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepack": "npm run build",
    "test": "node --import tsx --test test/*.test.ts",
    "start": "tsx src/cli.ts",
    "test:live": "node --import tsx --test test/live/*.test.ts"
  },
  "engines": {
    "node": ">=22.19.0"
  },
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

Start with `.pi-files/CHEATCODES.md`.
```

## `src/cli.ts`

```typescript
#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectStatus, runWorker } from "./run.js";

function usage(): string {
  return "Usage:\n  cheatcodes run\n  cheatcodes status";
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
  if (command === "run" || command === "auto") {
    const result = await runWorker();
    if (result.outcome === "failed" || result.outcome === "timeout") {
      console.error(`cheatcodes ${command}: ${result.outcome}${result.reason ? `: ${result.reason}` : ""}`);
      process.exitCode = 1;
      return;
    }
    if (result.run) {
      for (const warning of result.run.warnings) console.warn(`warning: ${warning}`);
      console.log(`Processed ${result.run.changedFiles} changed file(s), ${result.run.curatorCalls} curator call(s), ${result.run.entriesWritten} entry write(s).`);
    } else {
      console.log(`cheatcodes ${command}: ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`);
    }
  } else if (command === "status") {
    const result = await projectStatus();
    console.log(`Project ${result.projectKey} at ${result.root}`);
    console.log(`Inputs: ${result.discoveredFiles} session file(s) discovered, ${result.skipped.length} skipped, ${result.missingInputs.length} missing input(s).`);
    console.log(`Entries: ${result.entries} in ${result.knowledgeFile}.`);
    if (result.lastRun) {
      console.log(`Last run: ${result.lastRun.outcome}${result.lastRun.reason ? ` (${result.lastRun.reason})` : ""} at ${result.lastRun.finishedAt}.`);
    } else {
      console.log("Last run: none recorded.");
    }
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
import { createHash } from "node:crypto";

export interface KnowledgeEntry {
  id: string;
  title: string;
  summary: string;
  body: string;
  date?: string;
  tags?: string[];
  sources?: string[];
}

export interface CuratedEntryInput {
  action: "create" | "update";
  targetEntryId?: string;
  title: string;
  summary: string;
  body: string;
  date?: string;
  tags?: string[];
  sources?: string[];
}

export class KnowledgeValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid knowledge entry:\n- ${issues.join("\n- ")}`);
    this.name = "KnowledgeValidationError";
    this.issues = issues;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OPEN_MARKER = "<!-- cheatcodes-entry ";
const CLOSE_MARKER = "<!-- /cheatcodes-entry -->";
const DOCUMENT_HEADING = "# CHEATCODES";
const RESERVED_TEXT = [OPEN_MARKER, CLOSE_MARKER, "-->"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${field} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function rejectReserved(value: string, field: string, issues: string[]): void {
  for (const marker of RESERVED_TEXT) {
    if (value.includes(marker)) {
      issues.push(`${field} must not contain reserved text: ${marker.trim()}`);
      return;
    }
  }
}

function normalizeMultiline(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function normalizeList(value: unknown, field: string, issues: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${field} must be a list of non-empty strings`);
    return [];
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    const itemText = requiredString(item, `${field}[${index}]`, issues);
    if (itemText && !result.includes(itemText)) result.push(itemText);
  });
  return result.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function optionalDate(value: unknown, issues: string[]): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") {
    issues.push("date must be an ISO 8601 datetime string");
    return undefined;
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    issues.push("date must be an ISO 8601 datetime string");
    return undefined;
  }
  return parsed.toISOString();
}

export function validateEntry(value: unknown): KnowledgeEntry {
  const issues: string[] = [];
  if (!isRecord(value)) throw new KnowledgeValidationError(["entry must be a mapping"]);

  const id = requiredString(value.id, "id", issues);
  if (id && !ID_PATTERN.test(id)) {
    issues.push("id may contain only letters, digits, dots, underscores, and hyphens");
  }
  const title = requiredString(value.title, "title", issues);
  const summary = requiredString(value.summary, "summary", issues);
  const body = requiredString(value.body, "body", issues);
  const date = optionalDate(value.date, issues);
  const tags = normalizeList(value.tags, "tags", issues);
  const sources = normalizeList(value.sources, "sources", issues);

  for (const [field, text] of [["id", id], ["title", title], ["summary", summary], ["body", body]] as const) {
    if (text) rejectReserved(text, field, issues);
  }
  tags.forEach((tag, index) => rejectReserved(tag, `tags[${index}]`, issues));
  sources.forEach((source, index) => rejectReserved(source, `sources[${index}]`, issues));

  if (issues.length > 0) throw new KnowledgeValidationError(issues);
  const entry: KnowledgeEntry = { id, title, summary, body: normalizeMultiline(body) };
  if (date) entry.date = date;
  if (tags.length > 0) entry.tags = tags;
  if (sources.length > 0) entry.sources = sources;
  return entry;
}

interface EntryMetadata {
  id: string;
  title: string;
  summary: string;
  date?: string;
  tags?: string[];
  sources?: string[];
}

function metadataFor(entry: KnowledgeEntry): EntryMetadata {
  const metadata: EntryMetadata = { id: entry.id, title: entry.title, summary: entry.summary };
  if (entry.date) metadata.date = entry.date;
  if (entry.tags && entry.tags.length > 0) metadata.tags = entry.tags;
  if (entry.sources && entry.sources.length > 0) metadata.sources = entry.sources;
  return metadata;
}

function renderBlock(entry: KnowledgeEntry): string {
  const valid = validateEntry(entry);
  const metadata = JSON.stringify(metadataFor(valid));
  return [
    `${OPEN_MARKER}${metadata}-->`,
    `## ${valid.title}`,
    "",
    valid.summary,
    "",
    valid.body,
    "",
    CLOSE_MARKER,
    "",
  ].join("\n");
}

function normalizeTitleKey(title: string): string {
  return title.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

function entryOrder(entry: KnowledgeEntry): string {
  return `${normalizeTitleKey(entry.title)}\u0000${entry.id}`;
}

export function renderKnowledgeMarkdown(entries: readonly KnowledgeEntry[]): string {
  const valid = entries.map((entry) => validateEntry(entry));
  valid.sort((a, b) => (entryOrder(a) < entryOrder(b) ? -1 : entryOrder(a) > entryOrder(b) ? 1 : 0));
  const blocks = valid.map((entry) => renderBlock(entry));
  return blocks.length > 0 ? `${DOCUMENT_HEADING}\n\n${blocks.join("")}` : `${DOCUMENT_HEADING}\n`;
}

function renderedPrefix(entry: KnowledgeEntry): string {
  return `## ${entry.title}\n\n${entry.summary}\n\n`;
}

export function parseKnowledgeMarkdown(markdown: string): KnowledgeEntry[] {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const entries: KnowledgeEntry[] = [];
  const ids = new Set<string>();
  let cursor = 0;
  for (;;) {
    const open = normalized.indexOf(OPEN_MARKER, cursor);
    if (open < 0) break;
    const metadataStart = open + OPEN_MARKER.length;
    const metadataEnd = normalized.indexOf("-->", metadataStart);
    if (metadataEnd < 0) throw new KnowledgeValidationError(["entry metadata must be closed with -->"]);
    let raw: unknown;
    const metadataText = normalized.slice(metadataStart, metadataEnd);
    try {
      raw = JSON.parse(metadataText);
    } catch {
      throw new KnowledgeValidationError([`entry metadata must be valid JSON: ${metadataText.slice(0, 80)}`]);
    }
    if (!isRecord(raw)) throw new KnowledgeValidationError(["entry metadata must be a JSON object"]);
    const blockStart = metadataEnd + 3;
    const blockEnd = normalized.indexOf(CLOSE_MARKER, blockStart);
    if (blockEnd < 0) throw new KnowledgeValidationError(["entry must be closed with a closing comment"]);
    const rendered = normalized.slice(blockStart, blockEnd).replace(/^\n/, "");
    const partial = validateEntry({ ...raw, body: "structural-placeholder" });
    const prefix = renderedPrefix(partial);
    if (!rendered.startsWith(prefix)) {
      throw new KnowledgeValidationError([`entry ${partial.id} must render its title and summary after the metadata`]);
    }
    const entry = validateEntry({ ...raw, body: rendered.slice(prefix.length) });
    if (ids.has(entry.id)) throw new KnowledgeValidationError([`duplicate entry id: ${entry.id}`]);
    ids.add(entry.id);
    entries.push(entry);
    cursor = blockEnd + CLOSE_MARKER.length;
  }
  return entries;
}

export function deriveEntryId(projectKey: string, title: string): string {
  const digest = createHash("sha256").update(`${projectKey}\u0000${normalizeTitleKey(title)}`).digest("hex");
  return `cc-${digest.slice(0, 24)}`;
}

function mergedValues(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  return [...new Set([...(existing ?? []), ...(incoming ?? [])])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sameEntry(a: KnowledgeEntry, b: KnowledgeEntry): boolean {
  return renderBlock(a) === renderBlock(b);
}

export function applyCuratedEntry(
  entries: readonly KnowledgeEntry[],
  input: CuratedEntryInput,
  projectKey: string,
): { entries: KnowledgeEntry[]; changed: boolean; id: string } {
  const issues: string[] = [];
  if (input.action !== "create" && input.action !== "update") issues.push("action must be create or update");
  if (issues.length > 0) throw new KnowledgeValidationError(issues);

  if (input.action === "update") {
    if (!input.targetEntryId) throw new KnowledgeValidationError(["update requires targetEntryId"]);
    const index = entries.findIndex((entry) => entry.id === input.targetEntryId);
    if (index < 0) throw new KnowledgeValidationError([`update target not found: ${input.targetEntryId}`]);
    const existing = entries[index]!;
    const next = validateEntry({
      id: existing.id,
      title: input.title,
      summary: input.summary,
      body: input.body,
      date: input.date ?? existing.date,
      tags: mergedValues(existing.tags, input.tags),
      sources: mergedValues(existing.sources, input.sources),
    });
    const changed = !sameEntry(existing, next);
    if (!changed) return { entries: [...entries], changed, id: existing.id };
    const updated = entries.slice();
    updated[index] = next;
    return { entries: updated, changed, id: next.id };
  }

  const id = deriveEntryId(projectKey, input.title);
  const entry = validateEntry({
    id,
    title: input.title,
    summary: input.summary,
    body: input.body,
    date: input.date,
    tags: input.tags,
    sources: input.sources,
  });
  const index = entries.findIndex((existing) => existing.id === id);
  if (index >= 0) {
    const existing = entries[index]!;
    if (normalizeTitleKey(existing.title) !== normalizeTitleKey(entry.title)) {
      throw new KnowledgeValidationError([`entry id ${id} already belongs to "${existing.title}"`]);
    }
    const merged = validateEntry({
      ...entry,
      date: input.date ?? existing.date,
      tags: mergedValues(existing.tags, entry.tags),
      sources: mergedValues(existing.sources, entry.sources),
    });
    const changed = !sameEntry(existing, merged);
    if (!changed) return { entries: [...entries], changed, id };
    const updated = entries.slice();
    updated[index] = merged;
    return { entries: updated, changed, id };
  }
  return { entries: [...entries, entry], changed: true, id };
}
```

## `src/config.ts`

```typescript
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { renderKnowledgeMarkdown } from "./concept.js";
import { atomicWrite, sha256 } from "./state.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export const PRODUCER_VERSION: string = require("../package.json").version as string;

export interface GlobalConfig {
  version: 2;
  model: string;
  inputs: string[];
  workerTimeoutMinutes: number;
  knowledgeFile?: string;
  contextPointer?: boolean;
  projectAliases: Record<string, string[]>;
}

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

const VERSION_2_EXAMPLE = `{"version":2,"model":"<model>","inputs":[],"workerTimeoutMinutes":10,"projectAliases":{}}`;

export function validateGlobalConfig(value: unknown, source = "config"): GlobalConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["version", "model", "inputs", "workerTimeoutMinutes", "knowledgeFile", "contextPointer", "projectAliases"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`${source}.${key} is not a recognized field`);
  }
  if (raw.version !== 2) {
    if (raw.version === 1) {
      throw new Error(`${source}.version is 1; config version 2 removed "automation" ("enabled", "setupMissingProjects"). Replace ${source} with ${VERSION_2_EXAMPLE}`);
    }
    throw new Error(`${source}.version must be 2`);
  }
  if (raw.automation !== undefined) throw new Error(`${source}.automation was removed in config version 2; delete the field`);
  const timeout = raw.workerTimeoutMinutes;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) throw new Error(`${source}.workerTimeoutMinutes must be a positive number`);
  let knowledgeFile: string | undefined;
  if (raw.knowledgeFile !== undefined) {
    knowledgeFile = nonempty(raw.knowledgeFile, `${source}.knowledgeFile`);
    if (path.isAbsolute(knowledgeFile) || knowledgeFile.split(/[\\/]/).includes("..")) {
      throw new Error(`${source}.knowledgeFile must be a repository-relative path`);
    }
  }
  let contextPointer: boolean | undefined;
  if (raw.contextPointer !== undefined) {
    if (typeof raw.contextPointer !== "boolean") throw new Error(`${source}.contextPointer must be a boolean`);
    contextPointer = raw.contextPointer;
  }
  const aliasesRaw = raw.projectAliases;
  if (!aliasesRaw || typeof aliasesRaw !== "object" || Array.isArray(aliasesRaw)) throw new Error(`${source}.projectAliases must be an object`);
  const projectAliases: Record<string, string[]> = {};
  for (const [key, paths] of Object.entries(aliasesRaw)) projectAliases[nonempty(key, `${source}.projectAliases key`)] = stringList(paths, `${source}.projectAliases.${key}`);
  return {
    version: 2,
    model: nonempty(raw.model, `${source}.model`),
    inputs: stringList(raw.inputs, `${source}.inputs`),
    workerTimeoutMinutes: timeout,
    knowledgeFile,
    contextPointer,
    projectAliases,
  };
}

export function emptyGlobalConfig(model: string): GlobalConfig {
  return { version: 2, model, inputs: [], workerTimeoutMinutes: 10, projectAliases: {} };
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
  await atomicWrite(globalConfigPath(env), `${JSON.stringify(config, null, 2)}\n`);
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

export function resolveProjectRoots(config: GlobalConfig, root: string, projectKey: string): string[] {
  const aliases = (config.projectAliases[projectKey] ?? []).map((value) => path.resolve(expandHome(value)));
  return [...new Set([path.resolve(root), ...aliases])];
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

async function realPath(value: string): Promise<string> {
  try { return await realpath(value); } catch { return path.resolve(value); }
}

export async function deriveProjectKey(root: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" });
    const normalized = normalizeGitRemote(stdout);
    if (normalized) return `git:${sha256(normalized)}`;
  } catch {
    // No origin remote; fall back to the real repository path.
  }
  return `path:${sha256(await realPath(root))}`;
}

export const DEFAULT_KNOWLEDGE_FILE = "CHEATCODES.md";

export function knowledgeFilePath(root: string, knowledgeFile = DEFAULT_KNOWLEDGE_FILE): string {
  const resolved = path.resolve(root, knowledgeFile);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`knowledgeFile must stay inside the repository: ${knowledgeFile}`);
  }
  return resolved;
}

function knowledgePointer(knowledgeFile: string): string {
  return `## Project knowledge\n\nStart with \`${knowledgeFile}\`.`;
}

const LEGACY_KNOWLEDGE_POINTER = "## Project knowledge\n\nStart with `.cheatcodes/knowledge/index.md`. Check concept status before relying on a draft.";

async function updateContextPointer(root: string, knowledgeFile: string): Promise<string> {
  const override = path.join(root, "AGENTS.override.md");
  const regular = path.join(root, "AGENTS.md");
  let target = regular;
  try { await readFile(override); target = override; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let existing = "";
  try { existing = await readFile(target, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const pointer = knowledgePointer(knowledgeFile);
  if (existing.includes(pointer)) return target;
  let next: string;
  if (existing.includes(LEGACY_KNOWLEDGE_POINTER)) {
    next = existing.replace(LEGACY_KNOWLEDGE_POINTER, pointer);
  } else {
    next = `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${pointer}\n`;
  }
  await writeFile(target, next);
  return target;
}

export interface KnowledgeOutput { knowledgeFile: string; contextFile?: string }

export async function ensureKnowledgeOutput(root: string, knowledgeFile = DEFAULT_KNOWLEDGE_FILE, contextPointer = true): Promise<KnowledgeOutput> {
  const knowledgePath = knowledgeFilePath(root, knowledgeFile);
  try {
    await readFile(knowledgePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path.dirname(knowledgePath), { recursive: true });
    await atomicWrite(knowledgePath, renderKnowledgeMarkdown([]));
  }
  if (!contextPointer) return { knowledgeFile: knowledgePath };
  const contextFile = await updateContextPointer(root, knowledgeFile);
  return { knowledgeFile: knowledgePath, contextFile };
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

export const CuratedActionSchema = z.object({
  action: z.enum(["create", "update"]),
  targetEntryId: z.string().min(1).optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1)).min(1),
}).strict();
export const CuratorResponseSchema = z.object({ entries: z.array(CuratedActionSchema) }).strict();
export type CuratedEntry = z.infer<typeof CuratedActionSchema>;
export type CuratorResponse = z.infer<typeof CuratorResponseSchema>;

export interface CuratorOutcome { response?: CuratorResponse; schemaInvalid: boolean; warning?: string }
export interface Curator { curate(packet: HarvestPacket): Promise<CuratorOutcome | CuratorResponse> }

export const CURATOR_PROMPT = `You curate durable project knowledge from a bounded evidence packet.
Return exactly one JSON object with an entries array. Do not return Markdown or commentary.
Each entry has action "create" or "update", title, summary, body, tags, and evidenceRefs.
Every entry states only current project truth. Do not describe history, addenda, or replaced guidance.
For updates, set targetEntryId to the supplied update candidate ID and return the complete revised entry: the body must replace the candidate's body entirely rather than append.
Creates must omit targetEntryId.
Use only supplied evidence IDs. Never invent IDs, paths, timestamps, or provenance.
Return {"entries":[]} when the evidence does not justify durable knowledge.`;

export function validateCuratorResponse(value: unknown, packet: HarvestPacket): CuratorResponse {
  const parsed = CuratorResponseSchema.parse(value);
  const evidenceIds = new Set(packet.evidence.map((item) => item.id));
  const updated = new Set<string>();
  for (const entry of parsed.entries) {
    for (const reference of entry.evidenceRefs) if (!evidenceIds.has(reference)) throw new Error(`Unknown evidence reference: ${reference}`);
    if (entry.action === "create" && entry.targetEntryId !== undefined) throw new Error("Create action must not include targetEntryId");
    if (entry.action === "update") {
      if (!entry.targetEntryId) throw new Error("Update action requires targetEntryId");
      if (!packet.updateCandidate || packet.updateCandidate.id !== entry.targetEntryId) throw new Error("Update target is not the packet update candidate");
      if (updated.has(entry.targetEntryId)) throw new Error("A target may be updated only once per response");
      updated.add(entry.targetEntryId);
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

export interface EntrySummary {
  id: string;
  title: string;
  summary: string;
  tags?: string[];
  body?: string;
}

export interface ShortlistItem {
  id: string;
  title: string;
  summary: string;
  score: number;
}

export interface UpdateCandidate extends ShortlistItem { body: string }

export interface HarvestPacket {
  id: string;
  projectKey: string;
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
  projectKey: string;
  entries?: readonly EntrySummary[];
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

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []);
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const term of left) if (right.has(term)) count++;
  return count;
}

export function shortlistEntries(
  episode: Episode,
  entries: readonly EntrySummary[],
  limit = SHORTLIST_LIMIT,
): { shortlist: ShortlistItem[]; updateCandidate?: UpdateCandidate } {
  const episodeText = episode.records.map((record) => [record.text, record.receipt?.path, record.receipt?.command].filter(Boolean).join(" ")).join(" ");
  const episodeTerms = terms(episodeText);
  const ranked = entries.map((entry) => {
    const titleScore = overlap(episodeTerms, terms(entry.title)) * 4;
    const tagScore = overlap(episodeTerms, terms((entry.tags ?? []).join(" "))) * 3;
    const summaryScore = overlap(episodeTerms, terms(entry.summary));
    return { entry, item: { id: entry.id, title: entry.title, summary: entry.summary, score: titleScore + tagScore + summaryScore } };
  }).filter((item) => item.item.score > 0)
    .sort((a, b) => b.item.score - a.item.score || a.item.title.localeCompare(b.item.title) || a.item.id.localeCompare(b.item.id))
    .slice(0, Math.max(0, limit));
  const shortlist = ranked.map((item) => item.item);
  const candidate = ranked[0];
  const updateCandidate = candidate && candidate.entry.body
    ? { ...candidate.item, body: candidate.entry.body }
    : undefined;
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
  const related = shortlistEntries(episode, options.entries ?? [], options.shortlistLimit ?? SHORTLIST_LIMIT);
  const id = stableId("packet", [options.projectKey, episode.sessionId, ...episode.records.flatMap((record) => [record.id, record.byteHash])]);
  const packet: HarvestPacket = {
    id, projectKey: options.projectKey, sessionId: episode.sessionId, episodeId: episode.id,
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
  branches: NormalizedRecord[][];
  warnings: JsonlWarning[];
  completeOffset: number;
  completeSha256: string;
  previousPrefixSha256: string;
}

interface RawLine { value: Record<string, unknown>; range: ByteRange; hash: string; index: number }

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
    header, version: header.version, sessionId: header.id, records, branches: buildBranches(records), warnings,
    completeOffset, completeSha256: sha256(buffer.subarray(0, completeOffset)),
    previousPrefixSha256: sha256(buffer.subarray(0, previous)),
  };
}

export async function parseJsonlFile(file: string, options: Omit<ParseJsonlOptions, "file"> = {}): Promise<ParsedSession> {
  return parseJsonlBytes(await readFile(file), { ...options, file });
}
```

## `src/run.ts`

```typescript
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";
import {
  deriveProjectKey,
  discoverGitRoot,
  emptyGlobalConfig,
  ensureKnowledgeOutput,
  globalConfigPath,
  knowledgeFilePath,
  loadGlobalConfig,
  resolveGlobalInputs,
  resolveProjectRoots,
  saveGlobalConfig,
} from "./config.js";
import { applyCuratedEntry, parseKnowledgeMarkdown, renderKnowledgeMarkdown, type KnowledgeEntry } from "./concept.js";
import { normalizeCuratorOutcome, PiCurator, type Curator, type CuratedEntry } from "./curate.js";
import { createPacket, segmentSession, type EvidenceItem, type HarvestPacket } from "./harvest.js";
import { parseJsonlFile } from "./jsonl.js";
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
  warnings: string[];
  staleLockRecovered: boolean;
  deadlineExceeded: boolean;
}

function warningText(warning: ScanWarning): string { return `${warning.file}: ${warning.message}`; }

async function getCurator(options: RunOptions, root: string, model: string): Promise<Curator> {
  if (options.curator) return options.curator;
  if (options.curatorFactory) return options.curatorFactory();
  return PiCurator.create({ projectRoot: root, model });
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
  const root = options.root ? path.resolve(options.root) : await discoverGitRoot(options.cwd);
  if (!root) throw new Error("cheatcodes requires a Git repository; run it inside a project");
  const global = await loadGlobalConfig(env);
  if (!global) throw new Error(`No global config at ${globalConfigPath(env)}`);
  const projectKey = await deriveProjectKey(root);
  const lock = options.lock ?? await acquireProjectLock(env, projectKey);
  const knowledgeFile = knowledgeFilePath(root, global.knowledgeFile);
  const warnings: string[] = [];
  const warn = (message: string): void => { warnings.push(message); options.onWarning?.(message); };
  let curator: Curator | undefined;
  let curatorCalls = 0;
  let packets = 0;
  let entriesWritten = 0;
  let prunedCursors = 0;
  let deadlineExceeded = false;
  try {
    if (lock.staleRecovered) warn("Recovered a stale project mutation lock");
    await ensureKnowledgeOutput(root, global.knowledgeFile, global.contextPointer !== false);
    let entries: KnowledgeEntry[] = parseKnowledgeMarkdown(await readFile(knowledgeFile, "utf8"));
    const globalState = await loadGlobalState(env);
    const projectState: ProjectState = globalState.projects[projectKey] ?? { files: {} };
    const inputs = [...resolveGlobalInputs(global, env), ...(options.extraInputs ?? []).map((value) => path.resolve(value))];
    const projectRoots = resolveProjectRoots(global, root, projectKey);
    const scan = await scanInputs(inputs, projectRoots, projectState.files);
    scan.skipped.map(warningText).forEach(warn);
    scan.missing.forEach((file) => warn(`${file}: configured input does not exist`));
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
      const episodes = segmentSession(parsed);
      for (const episode of episodes) {
        const packet = createPacket(episode, { projectKey, entries });
        if (!packet) continue;
        packets++;
        curator ??= await getCurator(options, root, global.model);
        curatorCalls++;
        const outcome = normalizeCuratorOutcome(await curator.curate(packet), packet);
        if (outcome.schemaInvalid || !outcome.response) {
          warn(`Packet ${packet.id} was terminally skipped after schema validation failed${outcome.warning ? `: ${outcome.warning}` : ""}`);
          continue;
        }
        for (const curated of outcome.response.entries) {
          const result = applyCuratedEntry(entries, curatedInput(curated, sourceFor(packet, selectedEvidence(packet, curated)), sessionDate), projectKey);
          entries = result.entries;
          if (result.changed) {
            entriesWritten++;
            await renderAndStore(knowledgeFile, entries);
          }
        }
      }
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
    return { root, projectKey, changedFiles: scan.changed.length, curatorCalls, packets, entriesWritten, prunedCursors, warnings, staleLockRecovered: lock.staleRecovered, deadlineExceeded };
  } finally { await lock.release(); }
}

async function renderAndStore(knowledgeFile: string, entries: KnowledgeEntry[]): Promise<void> {
  await atomicWrite(knowledgeFile, renderKnowledgeMarkdown(entries));
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
  const projectRoot = root ? path.resolve(root) : await discoverGitRoot();
  if (!projectRoot) throw new Error("cheatcodes requires a Git repository; run it inside a project");
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
  const root = options.root ? path.resolve(options.root) : await discoverGitRoot(options.cwd);
  if (!root) return { outcome: "skipped", invocationId, reason: "outside a Git repository", warnings: [] };
  const hints = readLauncherHints(env);
  let global = await loadGlobalConfig(env);
  if (!global) {
    const model = hintModel(hints);
    if (!model) return { outcome: "skipped", invocationId, reason: `no global config at ${globalConfigPath(env)}`, warnings: [] };
    global = emptyGlobalConfig(model);
    await saveGlobalConfig(global, env);
  }
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
```

## `src/scan.ts`

```typescript
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { FileCursor } from "./state.js";

export interface SessionCandidate {
  file: string;
  size: number;
  mtimeMs: number;
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

export async function scanInputs(inputs: string[], projectRoots: string[], files: Record<string, FileCursor>): Promise<ScanResult> {
  const discovered: string[] = [];
  const skipped: ScanWarning[] = [];
  const missing: string[] = [];
  for (const input of [...new Set(inputs.map((value) => path.resolve(value)))].sort()) {
    let metadata;
    try { metadata = await stat(input); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { missing.push(input); continue; }
      skipped.push({ file: input, message: `Cannot scan input: ${(error as Error).message}` });
      continue;
    }
    if (metadata.isDirectory()) await discoverJsonl(input, discovered, skipped);
    else if (input.endsWith(".jsonl")) discovered.push(input);
    else skipped.push({ file: input, message: "Input is neither a directory nor a .jsonl file" });
  }
  const changed: SessionCandidate[] = [];
  const unchanged: string[] = [];
  for (const file of [...new Set(discovered)].sort()) {
    let metadata;
    try { metadata = await stat(file); } catch (error) { skipped.push({ file, message: `Cannot stat session: ${(error as Error).message}` }); continue; }
    const cursor = files[file];
    if (cursor && cursor.observedSize === metadata.size && cursor.mtimeMs === metadata.mtimeMs) { unchanged.push(file); continue; }
    try {
      const header = await readHeader(file);
      if (!matchProjectRoot(header.cwd, projectRoots)) { skipped.push({ file, message: "Session cwd is outside configured project roots" }); continue; }
      changed.push({ file, size: metadata.size, mtimeMs: metadata.mtimeMs });
    } catch (error) { skipped.push({ file, message: `Cannot read session header: ${(error as Error).message}` }); }
  }
  return { changed, unchanged, skipped, missing };
}
```

## `src/state.ts`

```typescript
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

export async function atomicWrite(file: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
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
```

## `test/auto.test.ts`

```typescript
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { deriveProjectKey, emptyGlobalConfig, globalConfigPath, loadGlobalConfig, validateGlobalConfig } from "../src/config.js";
import type { Curator } from "../src/curate.js";
import { main } from "../src/cli.js";
import { projectStatus, runWorker, type RunOptions } from "../src/run.js";
import {
  acquireProjectLock,
  globalStatePath,
  loadGlobalState,
  projectLockPath,
  updateProjectState,
} from "../src/state.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

const execFileAsync = promisify(execFile);
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
    return { entries: [{ action: "create", title: "Use the repository adapter", summary: "Repository access uses the adapter.", body: "The repository adapter is the only persistence boundary.", tags: ["repository"], evidenceRefs: [packet.evidence[0]!.id] }] };
  } };
}

async function sessionsWithFixture(root: string, sessionId = "session-1"): Promise<string> {
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, "one.jsonl"), fixture(root, sessionId));
  return sessions;
}

async function gitInit(root: string): Promise<void> {
  await execFileAsync("git", ["init", "-q", root]);
}

function withCurator(options: RunOptions, curator: Curator): RunOptions {
  return { ...options, curator };
}

test("global config path honors the environment, XDG, and home fallbacks", () => {
  assert.equal(globalConfigPath({ CHEATCODES_CONFIG: "/tmp/explicit.json" }), path.resolve("/tmp/explicit.json"));
  assert.equal(globalConfigPath({ XDG_CONFIG_HOME: "/xdg" }), path.join("/xdg", "cheatcodes", "config.json"));
  assert.equal(globalConfigPath({}), path.join(homedir(), ".config", "cheatcodes", "config.json"));
});

test("global state path honors the override, XDG, and home fallbacks", () => {
  assert.equal(globalStatePath({ CHEATCODES_STATE: "/tmp/state.json" }), path.resolve("/tmp/state.json"));
  assert.equal(globalStatePath({ XDG_STATE_HOME: "/xdg-state" }), path.join("/xdg-state", "cheatcodes", "state.json"));
  assert.equal(globalStatePath({}), path.join(homedir(), ".local", "state", "cheatcodes", "state.json"));
});

test("global config validation enforces the version 2 shape", () => {
  assert.throws(() => validateGlobalConfig({ version: 1, model: "m", inputs: [], workerTimeoutMinutes: 1, projectAliases: {} }), /config version 2 removed "automation"/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), automation: { enabled: true, setupMissingProjects: true } }), /automation is not a recognized field/);
  assert.throws(() => validateGlobalConfig({ version: 3 }), /version must be 2/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), surprise: true }), /not a recognized field/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig(undefined) }), /model/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), workerTimeoutMinutes: 0 }), /workerTimeoutMinutes/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), knowledgeFile: "/tmp/out.md" }), /repository-relative/);
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), knowledgeFile: "../escape.md" }), /repository-relative/);
  const configured = validateGlobalConfig({ ...emptyGlobalConfig("m"), knowledgeFile: ".pi-files/CHEATCODES.md" });
  assert.equal(configured.knowledgeFile, ".pi-files/CHEATCODES.md");
  assert.throws(() => validateGlobalConfig({ ...emptyGlobalConfig("m"), contextPointer: "yes" }), /contextPointer must be a boolean/);
  assert.equal(validateGlobalConfig({ ...emptyGlobalConfig("m"), contextPointer: false }).contextPointer, false);
  const valid = validateGlobalConfig(emptyGlobalConfig("m"));
  assert.equal(valid.version, 2);
});

test("project keys derive from the normalized remote and fall back to the real path", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const pathKey = await deriveProjectKey(root);
    assert.match(pathKey, /^path:[0-9a-f]{64}$/);
    const again = await deriveProjectKey(root);
    assert.equal(again, pathKey);
    await execFileAsync("git", ["-C", root, "remote", "add", "origin", "git@GitHub.com:Example/Org.Repo.git"], { cwd: root });
    const remoteKey = await deriveProjectKey(root);
    assert.match(remoteKey, /^git:[0-9a-f]{64}$/);
    assert.notEqual(remoteKey, pathKey);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("run outside a Git repository is skipped without writes", async () => {
  const cwd = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json"), CHEATCODES_STATE: path.join(configDir, "state.json") };
    const result = await runWorker({ cwd, env });
    assert.equal(result.outcome, "skipped");
    assert.match(result.reason!, /outside a Git repository/);
    assert.deepEqual(await readdir(cwd), []);
    assert.equal(await loadGlobalConfig(env), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("run skips when no config exists and no model hint is available", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    await gitInit(root);
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json"), CHEATCODES_STATE: path.join(configDir, "state.json") };
    const result = await runWorker({ root, env });
    assert.equal(result.outcome, "skipped");
    assert.match(result.reason!, /no global config/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("a model hint creates a missing version 2 config and never overwrites an existing model", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    await gitInit(root);
    const env: NodeJS.ProcessEnv = {
      CHEATCODES_CONFIG: path.join(configDir, "config.json"),
      CHEATCODES_STATE: path.join(configDir, "state.json"),
      CHEATCODES_PI_MODEL: "prov/m1",
      CHEATCODES_PI_THINKING: "high",
    };
    const result = await runWorker({ root, env, curator: fakeCurator({ count: 0 }) });
    assert.equal(result.outcome, "success");
    const created = await loadGlobalConfig(env);
    assert.equal(created!.model, "prov/m1:thinking");
    assert.deepEqual(created!.inputs, []);
    const { env: existingEnv } = await writeGlobalConfig({ dir: configDir, model: "fake/model" });
    const envWithHint = { ...existingEnv, CHEATCODES_PI_MODEL: "other/model" };
    await runWorker({ root, env: envWithHint, curator: fakeCurator({ count: 0 }) });
    assert.equal((await loadGlobalConfig(envWithHint))!.model, "fake/model");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("run creates the knowledge file and global state but no repository-local runtime data", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const result = await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    assert.equal(result.outcome, "success");
    await stat(path.join(root, "CHEATCODES.md"));
    const entries = await readdir(root);
    assert.equal(entries.includes(".cheatcodes"), false);
    assert.equal(entries.includes("worker.jsonl"), false);
    const state = await loadGlobalState(env);
    const project = state.projects[result.projectKey!]!;
    assert.equal(Object.keys(project.files).length, 1);
    assert.equal(project.lastRun!.outcome, "success");
    assert.equal(project.lastRun!.changedFiles, 1);
    await assert.rejects(stat(path.join(root, "last-run.json")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("contextPointer false creates the knowledge file without touching AGENTS.md", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions], contextPointer: false });
    const result = await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    assert.equal(result.outcome, "success");
    await stat(path.join(root, "CHEATCODES.md"));
    await assert.rejects(stat(path.join(root, "AGENTS.md")), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("contextPointer false leaves an existing AGENTS.md untouched", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    await writeFile(path.join(root, "AGENTS.md"), "# Existing agents notes\n");
    const { env } = await writeGlobalConfig({ inputs: [sessions], contextPointer: false });
    const result = await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    assert.equal(result.outcome, "success");
    assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8"), "# Existing agents notes\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("knowledgeFile config moves the knowledge file and the AGENTS pointer", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions], knowledgeFile: ".pi-files/CHEATCODES.md" });
    const result = await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    assert.equal(result.outcome, "success");
    await stat(path.join(root, ".pi-files", "CHEATCODES.md"));
    await assert.rejects(stat(path.join(root, "CHEATCODES.md")), /ENOENT/);
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.match(agents, /Start with `\.pi-files\/CHEATCODES\.md`\./);
    const status = await projectStatus(root, env);
    assert.equal(status.entries, 1);
    assert.match(status.knowledgeFile, /\.pi-files\/CHEATCODES\.md$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("direct session-file hints are scanned as extra inputs", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [] });
    const envWithHints = { ...env, CHEATCODES_PI_SESSION_FILE: path.join(sessions, "one.jsonl") };
    const calls = { count: 0 };
    const result = await runWorker(withCurator({ root, env: envWithHints }, fakeCurator(calls)));
    assert.equal(result.outcome, "success");
    assert.equal(result.run!.changedFiles, 1);
    assert.equal(calls.count, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a second run coalesces under the project lock and records the outcome", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const projectKey = await deriveProjectKey(root);
    await acquireProjectLock(env, projectKey);
    const calls = { count: 0 };
    const result = await runWorker(withCurator({ root, env }, fakeCurator(calls)));
    assert.equal(result.outcome, "coalesced");
    assert.equal(calls.count, 0);
    const state = await loadGlobalState(env);
    assert.equal(state.projects[projectKey]!.lastRun!.outcome, "coalesced");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a stale lock is recovered automatically", async () => {
  const root = await temporary();
  const configDir = await temporary("cheatcodes-config-");
  try {
    await gitInit(root);
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json"), CHEATCODES_STATE: path.join(configDir, "state.json") };
    const projectKey = await deriveProjectKey(root);
    const lockFile = projectLockPath(env, projectKey);
    await mkdir(path.dirname(lockFile), { recursive: true });
    const dead = spawn(process.execPath, ["-e", ""]);
    await new Promise<void>((resolve) => dead.on("exit", () => resolve()));
    await writeFile(lockFile, `${JSON.stringify({ pid: dead.pid, startedAt: "2026-01-01T00:00:00Z" })}\n`);
    const lock = await acquireProjectLock(env, projectKey);
    assert.equal(lock.staleRecovered, true);
    await lock.release();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("worker timeout aborts work, records the timeout, and releases the lock", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
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
    const result = await runWorker({ root, env, curator: sleepyCurator });
    assert.equal(result.outcome, "timeout");
    assert.equal(result.run!.deadlineExceeded, true);
    const state = await loadGlobalState(env);
    assert.equal(state.projects[result.projectKey!]!.lastRun!.outcome, "timeout");
    await assert.rejects(stat(projectLockPath(env, result.projectKey!)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status reports one entry count and the latest global run result", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    const status = await projectStatus(root, env);
    assert.equal(status.discoveredFiles, 1);
    assert.equal(status.entries, 1);
    assert.equal(status.lastRun!.outcome, "success");
    assert.deepEqual(status.missingInputs, []);
    assert.match(status.projectKey, /^(git|path):[0-9a-f]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("removed inputs prune obsolete cursors from global state", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    await rm(sessions, { recursive: true });
    const result = await runWorker(withCurator({ root, env }, fakeCurator({ count: 0 })));
    assert.equal(result.run!.prunedCursors, 1);
    const state = await loadGlobalState(env);
    assert.deepEqual(state.projects[result.projectKey!]!.files, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("two projects keep isolated entries in one global state file", async () => {
  const configDir = await temporary("cheatcodes-config-");
  const rootA = await temporary();
  const rootB = await temporary();
  try {
    await gitInit(rootA);
    await gitInit(rootB);
    const sessionsA = await sessionsWithFixture(rootA, "a-1");
    const sessionsB = await sessionsWithFixture(rootB, "b-1");
    const { env } = await writeGlobalConfig({ dir: configDir, inputs: [sessionsA, sessionsB] });
    const [a, b] = await Promise.all([
      runWorker(withCurator({ root: rootA, env }, fakeCurator({ count: 0 }))),
      runWorker(withCurator({ root: rootB, env }, fakeCurator({ count: 0 }))),
    ]);
    assert.notEqual(a.projectKey, b.projectKey);
    const state = await loadGlobalState(env);
    assert.equal(Object.keys(state.projects).length, 2);
    assert.equal(state.projects[a.projectKey!]!.lastRun!.outcome, "success");
    assert.equal(state.projects[b.projectKey!]!.lastRun!.outcome, "success");
  } finally {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
});

test("concurrent state updates to different projects are merged", async () => {
  const configDir = await temporary("cheatcodes-config-");
  try {
    const env: NodeJS.ProcessEnv = { CHEATCODES_CONFIG: path.join(configDir, "config.json"), CHEATCODES_STATE: path.join(configDir, "state.json") };
    const cursor = { sessionId: "s", committedOffset: 1, observedSize: 1, mtimeMs: 1, prefixSha256: "abc" };
    await Promise.all([
      updateProjectState(env, "git:aaa", (project) => ({ ...project, files: { ...project.files, "a.jsonl": cursor } })),
      updateProjectState(env, "git:bbb", (project) => ({ ...project, files: { ...project.files, "b.jsonl": cursor } })),
    ]);
    const state = await loadGlobalState(env);
    assert.deepEqual(Object.keys(state.projects).sort(), ["git:aaa", "git:bbb"]);
  } finally { await rm(configDir, { recursive: true, force: true }); }
});

test("failed runs record the failure and return a failed outcome", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const failingCurator: Curator = { async curate() { throw new Error("curator exploded"); } };
    const result = await runWorker({ root, env, curator: failingCurator });
    assert.equal(result.outcome, "failed");
    assert.match(result.reason!, /curator exploded/);
    const state = await loadGlobalState(env);
    assert.equal(state.projects[result.projectKey!]!.lastRun!.outcome, "failed");
    await stat(path.join(root, "CHEATCODES.md"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unknown commands including init and publish fail with exit code 2", async () => {
  const original = process.exitCode;
  try {
    await main(["bogus"]);
    assert.equal(process.exitCode, 2);
    process.exitCode = original;
    await main(["init"]);
    assert.equal(process.exitCode, 2);
    process.exitCode = original;
    await main(["publish"]);
    assert.equal(process.exitCode, 2);
    process.exitCode = original;
    await main(["run", "--model", "x"]);
    assert.equal(process.exitCode, 2);
  } finally { process.exitCode = original; }
});
```

## `test/concept.test.ts`

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCuratedEntry,
  deriveEntryId,
  KnowledgeValidationError,
  parseKnowledgeMarkdown,
  renderKnowledgeMarkdown,
  validateEntry,
  type KnowledgeEntry,
} from "../src/concept.js";

function entry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "cc-aaaaaaaaaaaaaaaaaaaaaaaa",
    title: "Use repository adapter",
    summary: "All persistence goes through the repository adapter.",
    body: "The repository adapter is the only persistence boundary.",
    ...overrides,
  };
}

test("date metadata is normalized and round trips", () => {
  const stamped = entry({ date: "2026-08-29T18:39:05Z" });
  const markdown = renderKnowledgeMarkdown([stamped]);
  assert.match(markdown, /"date":"2026-08-29T18:39:05\.000Z"/);
  assert.deepEqual(parseKnowledgeMarkdown(markdown), [{ ...stamped, date: "2026-08-29T18:39:05.000Z" }]);
  const plain = renderKnowledgeMarkdown([entry()]);
  assert.equal(plain.includes('"date"'), false);
});

test("invalid date metadata is rejected", () => {
  assert.throws(() => validateEntry(entry({ date: "not-a-date" })), KnowledgeValidationError);
  assert.throws(() => validateEntry(entry({ date: 42 })), KnowledgeValidationError);
});

test("parse and render round trip", () => {
  const entries = [entry(), entry({ id: "cc-bbbbbbbbbbbbbbbbbbbbbbbb", title: "Zebra entry", body: "Second body." })];
  const parsed = parseKnowledgeMarkdown(renderKnowledgeMarkdown(entries));
  assert.deepEqual(parsed, entries);
});

test("render is deterministic and sorts by normalized title then id", () => {
  const entries = [
    entry({ id: "cc-2", title: "Same title" }),
    entry({ id: "cc-1", title: "Same title", body: "Other." }),
    entry({ id: "cc-0", title: "ALPHA TITLE", summary: "Case folding." }),
  ];
  const first = renderKnowledgeMarkdown(entries);
  const second = renderKnowledgeMarkdown([...entries].reverse());
  assert.equal(first, second);
  const order = parseKnowledgeMarkdown(first).map((item) => item.id);
  assert.deepEqual(order, ["cc-0", "cc-1", "cc-2"]);
});

test("unchanged entries render identical bytes", () => {
  const rendered = renderKnowledgeMarkdown([entry()]);
  const reparsed = parseKnowledgeMarkdown(rendered);
  assert.equal(renderKnowledgeMarkdown(reparsed), rendered);
});

test("empty document renders a heading only", () => {
  assert.equal(renderKnowledgeMarkdown([]), "# CHEATCODES\n");
  assert.deepEqual(parseKnowledgeMarkdown("# CHEATCODES\n"), []);
});

test("malformed metadata is rejected", () => {
  const broken = "# CHEATCODES\n\n<!-- cheatcodes-entry {not json} -->\n## T\n\nS\n\nB\n\n<!-- /cheatcodes-entry -->\n";
  assert.throws(() => parseKnowledgeMarkdown(broken), KnowledgeValidationError, /valid JSON/);
});

test("unterminated entries are rejected", () => {
  const broken = "# CHEATCODES\n\n<!-- cheatcodes-entry {} -->\nno closing marker";
  assert.throws(() => parseKnowledgeMarkdown(broken), KnowledgeValidationError);
});

function renderBlockFor(item: KnowledgeEntry): string {
  const document = renderKnowledgeMarkdown([item]);
  return document.slice("# CHEATCODES\n\n".length).trimEnd();
}

test("duplicate ids are rejected", () => {
  const rendered = [
    "# CHEATCODES",
    "",
    renderBlockFor(entry()),
    renderBlockFor(entry({ body: "Different body." })),
  ].join("\n");
  assert.throws(() => parseKnowledgeMarkdown(rendered), KnowledgeValidationError, /duplicate entry id/);
});

test("reserved delimiters are rejected", () => {
  assert.throws(
    () => renderKnowledgeMarkdown([entry({ body: "text <!-- /cheatcodes-entry --> more" })]),
    KnowledgeValidationError,
  );
  assert.throws(() => renderKnowledgeMarkdown([entry({ summary: "uses --> inside" })]), KnowledgeValidationError);
});

test("validation requires non-empty strict fields", () => {
  assert.throws(() => renderKnowledgeMarkdown([entry({ title: "   " })]), KnowledgeValidationError);
  assert.throws(() => renderKnowledgeMarkdown([{ ...entry(), summary: 42 }]), KnowledgeValidationError);
  assert.throws(() => renderKnowledgeMarkdown([entry({ id: "bad id!" })]), KnowledgeValidationError);
});

test("tags and sources are sorted and deduplicated", () => {
  const rendered = renderKnowledgeMarkdown([
    entry({ tags: ["b", "a", "b"], sources: ["s2", "s1", "s2"] }),
  ]);
  const parsed = parseKnowledgeMarkdown(rendered)[0]!;
  assert.deepEqual(parsed.tags, ["a", "b"]);
  assert.deepEqual(parsed.sources, ["s1", "s2"]);
});

test("line endings and trailing whitespace are normalized", () => {
  const rendered = renderKnowledgeMarkdown([entry({ body: "line one  \r\nline two\t\r\n" })]);
  const parsed = parseKnowledgeMarkdown(rendered)[0]!;
  assert.equal(parsed.body, "line one\nline two");
});

test("deriveEntryId is deterministic and title-normalized", () => {
  const base = deriveEntryId("git:abc", "Use  The Adapter");
  assert.equal(base, deriveEntryId("git:abc", "use the adapter"));
  assert.match(base, /^cc-[0-9a-f]{24}$/);
  assert.notEqual(base, deriveEntryId("git:def", "Use The Adapter"));
  assert.notEqual(base, deriveEntryId("git:abc", "Other title"));
});

test("create is idempotent on replay and merges sources", () => {
  const projectKey = "git:abc";
  const first = applyCuratedEntry([], {
    action: "create",
    title: "Use repository adapter",
    summary: "One.",
    body: "Body one.",
    sources: ["session:s1#records=r1"],
  }, projectKey);
  assert.equal(first.changed, true);
  const second = applyCuratedEntry(first.entries, {
    action: "create",
    title: "Use repository adapter",
    summary: "One.",
    body: "Body one.",
    sources: ["session:s1#records=r1", "session:s2#records=r9"],
  }, projectKey);
  assert.equal(second.changed, true);
  assert.deepEqual(second.entries[0]!.sources, ["session:s1#records=r1", "session:s2#records=r9"]);
  const third = applyCuratedEntry(second.entries, {
    action: "create",
    title: "Use repository adapter",
    summary: "One.",
    body: "Body one.",
    sources: ["session:s1#records=r1", "session:s2#records=r9"],
  }, projectKey);
  assert.equal(third.changed, false);
  assert.deepEqual(third.entries, second.entries);
});

test("create id collision with a different normalized title fails", () => {
  const projectKey = "git:abc";
  const title = "Shared prefix";
  const first = applyCuratedEntry([], { action: "create", title, summary: "S", body: "B" }, projectKey);
  const handEdited = entry({
    id: first.id,
    title: "Different title",
    summary: "Hand-edited.",
    body: "Hand-edited body.",
  });
  assert.throws(
    () => applyCuratedEntry([handEdited], { action: "create", title, summary: "S", body: "B" }, projectKey),
    (error: unknown) => error instanceof KnowledgeValidationError && /already belongs/.test(error.message),
  );
});

test("update replaces the complete entry and preserves the id", () => {
  const projectKey = "git:abc";
  const created = applyCuratedEntry([], {
    action: "create",
    title: "Old title",
    summary: "Old summary.",
    body: "Old body with obsolete text and addenda.",
    tags: ["old"],
    sources: ["session:s1#records=r1"],
  }, projectKey);
  const id = created.id;
  const updated = applyCuratedEntry(created.entries, {
    action: "update",
    targetEntryId: id,
    title: "New title",
    summary: "New summary.",
    body: "Complete replacement body.",
    tags: ["new"],
  }, projectKey);
  assert.equal(updated.changed, true);
  assert.equal(updated.entries[0]!.id, id);
  assert.equal(updated.entries.length, 1);
  const text = renderKnowledgeMarkdown(updated.entries);
  assert.equal(text.includes("obsolete"), false);
  assert.equal(text.includes("New title"), true);
  assert.deepEqual(updated.entries[0]!.tags, ["new", "old"]);
});

test("update requires an existing target", () => {
  assert.throws(
    () => applyCuratedEntry([], { action: "update", targetEntryId: "cc-missing", title: "T", summary: "S", body: "B" }, "git:abc"),
    KnowledgeValidationError,
  );
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
  workerTimeoutMinutes?: number;
  knowledgeFile?: string;
  contextPointer?: boolean;
  projectAliases?: Record<string, string[]>;
}

export function globalConfigObject(options: GlobalConfigOptions = {}): Record<string, unknown> {
  return {
    version: 2,
    model: options.model ?? "fake/model",
    inputs: options.inputs ?? [],
    workerTimeoutMinutes: options.workerTimeoutMinutes ?? 10,
    ...(options.knowledgeFile !== undefined ? { knowledgeFile: options.knowledgeFile } : {}),
    ...(options.contextPointer !== undefined ? { contextPointer: options.contextPointer } : {}),
    projectAliases: options.projectAliases ?? {},
  };
}

export async function writeGlobalConfig(options: GlobalConfigOptions = {}): Promise<{ file: string; env: NodeJS.ProcessEnv }> {
  const dir = options.dir ?? await temporary("cheatcodes-config-");
  const file = path.join(dir, "config.json");
  await writeFile(file, JSON.stringify(globalConfigObject(options), null, 2));
  return { file, env: { CHEATCODES_CONFIG: file, CHEATCODES_STATE: path.join(dir, "state.json") } };
}
```

## `test/live/smoke.live.test.ts`

```typescript
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runProject } from "../src/run.js";
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
    await writeFile(path.join(sessions, "smoke.jsonl"), fixture(root));
    const result = await runProject({ root, env });
    console.log("run result:", JSON.stringify(result, null, 2));
    assert.equal(result.curatorCalls, 1);
    assert.ok(result.entriesWritten >= 1, "expected at least one entry write");
    const knowledge = await readFile(path.join(root, "CHEATCODES.md"), "utf8");
    console.log("--- CHEATCODES.md ---");
    console.log(knowledge);
    assert.match(knowledge, /^# CHEATCODES\n/);
    assert.match(knowledge, /## /);
    assert.equal(knowledge.includes("smoke-session"), false);
    const entries = await readdir(root);
    assert.equal(entries.includes(".cheatcodes"), false);
    for (const warning of result.warnings) console.log(`warning: ${warning}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

## `test/mvp.test.ts`

```typescript
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { Curator } from "../src/curate.js";
import { runProject } from "../src/run.js";
import { loadGlobalState } from "../src/state.js";
import { normalizeRepositoryPath, parseJsonlBytes, redactSecrets } from "../src/jsonl.js";
import { parseKnowledgeMarkdown } from "../src/concept.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

const execFileAsync = promisify(execFile);
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
    return { entries: [{ action: "create", title: "Use the repository adapter", summary: "Repository access uses the adapter.", body: "The repository adapter is the only persistence boundary.", tags: ["repository"], evidenceRefs: [packet.evidence[0]!.id] }] };
  } };
}

async function sessionsWithFixture(root: string, sessionId = "session-1"): Promise<string> {
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, "one.jsonl"), fixture(root, sessionId));
  return sessions;
}

async function gitInit(root: string): Promise<void> {
  await execFileAsync("git", ["init", "-q", root]);
}

test("first run discovers the Git root from a nested directory and creates one knowledge file", async () => {
  const root = await temporary();
  const originalCwd = process.cwd();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const nested = path.join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    process.chdir(nested);
    const calls = { count: 0 };
    const result = await runProject({ env, curator: fakeCurator(calls) });
    assert.equal(result.root, root);
    assert.equal(result.changedFiles, 1);
    assert.equal(calls.count, 1);
    const knowledge = await readFile(path.join(root, "CHEATCODES.md"), "utf8");
    assert.match(knowledge, /^# CHEATCODES\n/);
    assert.match(knowledge, /## Use the repository adapter\n/);
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.match(agents, /## Project knowledge/);
    assert.match(agents, /`CHEATCODES\.md`/);
    const entries = await readdir(root);
    assert.equal(entries.includes(".cheatcodes"), false);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("run requires a global config", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const env = { CHEATCODES_CONFIG: path.join(root, "missing", "config.json"), CHEATCODES_STATE: path.join(root, "state.json") };
    await assert.rejects(runProject({ root, env }), /No global config/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("run outside a Git repository fails", async () => {
  const cwd = await temporary();
  try {
    const { env } = await writeGlobalConfig();
    await assert.rejects(runProject({ cwd, env }), /Git repository/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("runs are deterministic and incremental with global state cursors", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    const first = await runProject({ root, env, curator: fakeCurator(calls) });
    assert.equal(first.curatorCalls, 1);
    assert.equal(first.entriesWritten, 1);
    const knowledgeFile = path.join(root, "CHEATCODES.md");
    const knowledgeAfterFirst = await readFile(knowledgeFile, "utf8");
    const stateAfterFirst = await loadGlobalState(env);
    const key = first.projectKey;
    const files = Object.keys(stateAfterFirst.projects[key]!.files);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.startsWith(sessions), true);
    const second = await runProject({ root, env, curator: fakeCurator(calls) });
    assert.equal(second.curatorCalls, 0);
    assert.equal(await readFile(knowledgeFile, "utf8"), knowledgeAfterFirst);
    assert.deepEqual(await loadGlobalState(env), stateAfterFirst);
    await writeFile(path.join(sessions, "one.jsonl"), fixture(root) + '{"type":"message","id":"u2"');
    const third = await runProject({ root, env, curator: fakeCurator(calls) });
    assert.equal(third.curatorCalls, 0);
    assert.equal(await readFile(knowledgeFile, "utf8"), knowledgeAfterFirst);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a rewritten source file is reconsidered without duplicating entries", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root, "session-1");
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    await runProject({ root, env, curator: fakeCurator(calls) });
    await writeFile(path.join(sessions, "one.jsonl"), fixture(root, "session-2"));
    const warnings: string[] = [];
    const second = await runProject({ root, env, curator: fakeCurator(calls), onWarning: (message) => warnings.push(message) });
    assert.equal(warnings.some((message) => /source was rewritten/.test(message)), true);
    assert.equal(second.curatorCalls, 1);
    assert.equal(second.entriesWritten, 1);
    const knowledge = await readFile(path.join(root, "CHEATCODES.md"), "utf8");
    assert.equal(knowledge.match(/## Use the repository adapter/g)?.length, 1);
    assert.match(knowledge, /session:session-1#records=/);
    assert.match(knowledge, /session:session-2#records=/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("durable output contains no evidence excerpts", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    const knowledge = await readFile(path.join(root, "CHEATCODES.md"), "utf8");
    assert.equal(knowledge.includes("No, that is wrong"), false);
    assert.equal(knowledge.includes("repository adapter is required"), false);
    assert.equal(knowledge.includes("cheatcodes/"), false);
    assert.match(knowledge, /session:session-1#records=/);
    const parsed = parseKnowledgeMarkdown(knowledge);
    const stamp = new Date((await stat(path.join(sessions, "one.jsonl"))).mtimeMs).toISOString();
    assert.equal(parsed[0]!.date, stamp);
    const tempFiles = (await readdir(root)).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(tempFiles, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the knowledge pointer is appended once and replaces the legacy pointer", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    const legacy = "## Project knowledge\n\nStart with `.cheatcodes/knowledge/index.md`. Check concept status before relying on a draft.";
    await writeFile(path.join(root, "AGENTS.md"), `# Agents\n\n${legacy}\n`);
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.equal(agents.includes(".cheatcodes/knowledge"), false);
    assert.equal(agents.match(/## Project knowledge/g)?.length, 1);
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    assert.equal((await readFile(path.join(root, "AGENTS.md"), "utf8")), agents);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("an existing AGENTS.md keeps its content and gains the pointer exactly once", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    await writeFile(path.join(root, "AGENTS.md"), "# My project\n\nBe nice to the code.\n");
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.equal(agents.startsWith("# My project\n\nBe nice to the code.\n"), true);
    assert.equal(agents.match(/## Project knowledge/g)?.length, 1);
    await runProject({ root, env, curator: fakeCurator({ count: 0 }) });
    assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8"), agents);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("secret redaction covers common credential shapes", () => {
  const redacted = redactSecrets([
    "token Bearer abc.def.ghi-jk",
    "key sk_live_ABCDEFGHIJKLmnop",
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12",
    "AKIAIOSFODNN7EXAMPLE",
    "https://user:hunter2@example.com/repo",
    "MY_API_KEY = super-secret-value",
    "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
  ].join("\n"));
  assert.equal(redacted.includes("Bearer abc"), false);
  assert.equal(redacted.includes("sk_live_ABCDEFGHIJKLmnop"), false);
  assert.equal(redacted.includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12"), false);
  assert.equal(redacted.includes("AKIAIOSFODNN7EXAMPLE"), false);
  assert.equal(redacted.includes("hunter2"), false);
  assert.equal(redacted.includes("super-secret-value"), false);
  assert.equal(redacted.includes("PRIVATE KEY-----\nabc"), false);
});

test("repository path normalization scopes paths to the project and redacts outside paths", () => {
  const root = "/repo";
  assert.equal(normalizeRepositoryPath("src/a.ts", "key", [root], root), "repo://key/src/a.ts");
  assert.equal(normalizeRepositoryPath("/repo/src/a.ts", "key", [root], root), "repo://key/src/a.ts");
  assert.equal(normalizeRepositoryPath("/etc/passwd", "key", [root], root), undefined);
  assert.equal(normalizeRepositoryPath("", "key", [root], root), undefined);
});

test("partial final JSONL lines are not committed until complete", () => {
  const complete = fixture("/repo", "s9");
  const parsed = parseJsonlBytes(Buffer.from(complete + `{"type":"message","id":"u2"`, { file: "f.jsonl" }));
  assert.equal(parsed.sessionId, "s9");
  assert.equal(parsed.records.some((record) => record.id === "u2"), false);
  assert.equal(complete.includes("u2"), false);
  const reparsed = parseJsonlBytes(Buffer.from(complete), { file: "f.jsonl" });
  assert.equal(reparsed.completeOffset, parsed.completeOffset);
  assert.equal(reparsed.completeSha256, parsed.completeSha256);
});

test("branch reconstruction follows parent chains across versions", () => {
  const record = (id: string, parentId: string | null, role: string) =>
    line({ type: "message", id, parentId, timestamp: "2026-01-01T00:00:00Z", message: { role, stopReason: "stop", content: [{ type: "text", text: `substantive message text for ${id}` }] } });
  const v1 = parseJsonlBytes(Buffer.from([
    line({ type: "session", id: "s", cwd: "/repo" }),
    record("a", null, "user"),
    record("b", undefined, "assistant"),
  ].join("")), { file: "v1.jsonl" });
  assert.equal(v1.branches.length, 1);
  assert.equal(v1.branches[0]!.length, 2);
  assert.equal(v1.branches[0]![1]!.parentId, v1.branches[0]![0]!.id);

  const v3 = parseJsonlBytes(Buffer.from([
    line({ type: "session", version: 3, id: "s", cwd: "/repo" }),
    record("a", null, "user"),
    record("b", "a", "assistant"),
    record("c", "b", "user"),
  ].join("")), { file: "v3.jsonl" });
  assert.equal(v3.branches.length, 1);
  assert.deepEqual(v3.branches[0]!.map((item) => item.id), ["a", "b", "c"]);
});

test("repository-boundary filtering skips sessions from other roots", async () => {
  const root = await temporary();
  try {
    await gitInit(root);
    const sessions = await sessionsWithFixture(root);
    await writeFile(path.join(sessions, "foreign.jsonl"), fixture("/elsewhere", "foreign-1"));
    const { env } = await writeGlobalConfig({ inputs: [sessions] });
    const calls = { count: 0 };
    const result = await runProject({ root, env, curator: fakeCurator(calls) });
    assert.equal(result.changedFiles, 1);
    await stat(path.join(root, "CHEATCODES.md"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
```


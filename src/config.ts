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

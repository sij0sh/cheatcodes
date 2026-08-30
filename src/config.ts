import { createRequire } from "node:module";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { renderKnowledgeMarkdown } from "./concept.js";
import { atomicWrite, sha256 } from "./state.js";

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
      throw new Error(`${source}.knowledgeFile must be a project-relative path`);
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

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(homedir(), value.slice(2));
  return value;
}

export function resolveGlobalInputs(config: GlobalConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const base = path.dirname(globalConfigPath(env));
  return [...new Set(config.inputs.map((value) => path.resolve(base, expandHome(value))))];
}

export async function discoverDefaultInputs(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const piAgentDir = env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".pi", "agent");
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude");
  const candidates = [
    path.join(path.resolve(expandHome(piAgentDir)), "sessions"),
    path.join(path.resolve(expandHome(claudeConfigDir)), "projects"),
  ];
  const discovered: string[] = [];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) discovered.push(candidate);
    } catch {
      // Missing or inaccessible harness directories are not configured.
    }
  }
  return discovered;
}

export function resolveProjectRoots(config: GlobalConfig, root: string, projectKey: string): string[] {
  const aliases = (config.projectAliases[projectKey] ?? []).map((value) => path.resolve(expandHome(value)));
  return [...new Set([path.resolve(root), ...aliases])];
}

async function realPath(value: string): Promise<string> {
  try { return await realpath(value); } catch { return path.resolve(value); }
}

export async function deriveProjectKey(root: string): Promise<string> {
  return `path:${sha256(await realPath(root))}`;
}

export const DEFAULT_KNOWLEDGE_FILE = "CHEATCODES.md";

export function knowledgeFilePath(root: string, knowledgeFile = DEFAULT_KNOWLEDGE_FILE): string {
  const resolved = path.resolve(root, knowledgeFile);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`knowledgeFile must stay inside the project: ${knowledgeFile}`);
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

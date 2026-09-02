import { createRequire } from "node:module";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { renderKnowledgeMarkdown } from "./concept.js";
import { atomicWrite, sha256 } from "./state.js";
const require = createRequire(import.meta.url);
export const PRODUCER_VERSION = require("../package.json").version;
export function globalConfigPath(env = process.env) {
    const override = env.CHEATCODES_CONFIG?.trim();
    if (override)
        return path.resolve(override);
    const xdg = env.XDG_CONFIG_HOME?.trim();
    const base = xdg ? xdg : path.join(homedir(), ".config");
    return path.join(base, "cheatcodes", "config.json");
}
function nonempty(value, name) {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${name} must be a non-empty string`);
    return value.trim();
}
function stringList(value, name) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
        throw new Error(`${name} must be a list of paths`);
    }
    return [...new Set(value.map((item) => item.trim()))];
}
const VERSION_2_EXAMPLE = `{"version":2,"model":"<model>","inputs":[],"workerTimeoutMinutes":10,"projectAliases":{}}`;
export function validateGlobalConfig(value, source = "config") {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${source} must be an object`);
    const raw = value;
    const allowed = new Set(["version", "model", "inputs", "workerTimeoutMinutes", "knowledgeFile", "contextPointer", "autorun", "tools", "autoMap", "projectAliases"]);
    for (const key of Object.keys(raw)) {
        if (!allowed.has(key))
            throw new Error(`${source}.${key} is not a recognized field`);
    }
    if (raw.version !== 2) {
        if (raw.version === 1) {
            throw new Error(`${source}.version is 1; config version 2 removed "automation" ("enabled", "setupMissingProjects"). Replace ${source} with ${VERSION_2_EXAMPLE}`);
        }
        throw new Error(`${source}.version must be 2`);
    }
    if (raw.automation !== undefined)
        throw new Error(`${source}.automation was removed in config version 2; delete the field`);
    const timeout = raw.workerTimeoutMinutes;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0)
        throw new Error(`${source}.workerTimeoutMinutes must be a positive number`);
    let knowledgeFile;
    if (raw.knowledgeFile !== undefined) {
        knowledgeFile = nonempty(raw.knowledgeFile, `${source}.knowledgeFile`);
        if (path.isAbsolute(knowledgeFile) || knowledgeFile.split(/[\\/]/).includes("..")) {
            throw new Error(`${source}.knowledgeFile must be a project-relative path`);
        }
    }
    let contextPointer;
    if (raw.contextPointer !== undefined) {
        if (typeof raw.contextPointer !== "boolean")
            throw new Error(`${source}.contextPointer must be a boolean`);
        contextPointer = raw.contextPointer;
    }
    let autorun;
    if (raw.autorun !== undefined) {
        if (typeof raw.autorun !== "boolean")
            throw new Error(`${source}.autorun must be a boolean`);
        autorun = raw.autorun;
    }
    let tools;
    if (raw.tools !== undefined) {
        if (typeof raw.tools !== "boolean")
            throw new Error(`${source}.tools must be a boolean`);
        tools = raw.tools;
    }
    let autoMap;
    if (raw.autoMap !== undefined) {
        if (typeof raw.autoMap !== "boolean")
            throw new Error(`${source}.autoMap must be a boolean`);
        autoMap = raw.autoMap;
    }
    const aliasesRaw = raw.projectAliases;
    if (!aliasesRaw || typeof aliasesRaw !== "object" || Array.isArray(aliasesRaw))
        throw new Error(`${source}.projectAliases must be an object`);
    const projectAliases = {};
    for (const [key, paths] of Object.entries(aliasesRaw))
        projectAliases[nonempty(key, `${source}.projectAliases key`)] = stringList(paths, `${source}.projectAliases.${key}`);
    return {
        version: 2,
        model: nonempty(raw.model, `${source}.model`),
        inputs: stringList(raw.inputs, `${source}.inputs`),
        workerTimeoutMinutes: timeout,
        knowledgeFile,
        contextPointer,
        autorun,
        tools,
        autoMap,
        projectAliases,
    };
}
export function emptyGlobalConfig(model) {
    return { version: 2, model, inputs: [], workerTimeoutMinutes: 10, projectAliases: {} };
}
export async function loadGlobalConfig(env = process.env) {
    try {
        const text = await readFile(globalConfigPath(env), "utf8");
        return validateGlobalConfig(JSON.parse(text), globalConfigPath(env));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
export async function saveGlobalConfig(config, env = process.env) {
    await atomicWrite(globalConfigPath(env), `${JSON.stringify(config, null, 2)}\n`);
}
function expandHome(value) {
    if (value === "~")
        return homedir();
    if (value.startsWith("~/") || value.startsWith("~\\"))
        return path.join(homedir(), value.slice(2));
    return value;
}
export function resolveGlobalInputs(config, env = process.env) {
    const base = path.dirname(globalConfigPath(env));
    return [...new Set(config.inputs.map((value) => path.resolve(base, expandHome(value))))];
}
export async function discoverDefaultInputs(env = process.env) {
    const piAgentDir = env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".pi", "agent");
    const candidate = path.join(path.resolve(expandHome(piAgentDir)), "sessions");
    try {
        if ((await stat(candidate)).isDirectory())
            return [candidate];
    }
    catch {
        // Missing or inaccessible Pi sessions are not configured.
    }
    return [];
}
export function resolveProjectRoots(config, root, projectKey) {
    const aliases = (config.projectAliases[projectKey] ?? []).map((value) => path.resolve(expandHome(value)));
    return [...new Set([path.resolve(root), ...aliases])];
}
async function realPath(value) {
    try {
        return await realpath(value);
    }
    catch {
        return path.resolve(value);
    }
}
export async function deriveProjectKey(root) {
    return `path:${sha256(await realPath(root))}`;
}
export const DEFAULT_KNOWLEDGE_FILE = ".agents/CHEATCODES.md";
export const LEGACY_DEFAULT_KNOWLEDGE_FILE = "CHEATCODES.md";
export function knowledgeFilePath(root, knowledgeFile = DEFAULT_KNOWLEDGE_FILE) {
    const resolved = path.resolve(root, knowledgeFile);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`knowledgeFile must stay inside the project: ${knowledgeFile}`);
    }
    return resolved;
}
function knowledgePointer(knowledgeFile) {
    return `Before working on anything non-obvious, check \`${knowledgeFile}\` or call \`search_knowledge\`; past sessions left decisions, constraints, and failure modes there.`;
}
function legacyKnowledgePointer(knowledgeFile) {
    return `## Project knowledge\n\nStart with \`${knowledgeFile}\`.`;
}
const LEGACY_KNOWLEDGE_POINTER = "## Project knowledge\n\nStart with `.cheatcodes/knowledge/index.md`. Check concept status before relying on a draft.";
async function updateContextPointer(root, knowledgeFile) {
    const override = path.join(root, "AGENTS.override.md");
    const regular = path.join(root, "AGENTS.md");
    let target = regular;
    try {
        await readFile(override);
        target = override;
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    let existing = "";
    try {
        existing = await readFile(target, "utf8");
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    const pointer = knowledgePointer(knowledgeFile);
    if (existing.includes(pointer))
        return target;
    let next;
    const legacyPointer = [LEGACY_KNOWLEDGE_POINTER, legacyKnowledgePointer(DEFAULT_KNOWLEDGE_FILE), legacyKnowledgePointer(LEGACY_DEFAULT_KNOWLEDGE_FILE)]
        .find((candidate) => existing.includes(candidate))
        ?? existing.match(/^## Project knowledge\n\nStart with `[^\n`]+`\.$/m)?.[0];
    if (legacyPointer) {
        next = existing.replace(legacyPointer, pointer);
    }
    else {
        next = `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${pointer}\n`;
    }
    await writeFile(target, next);
    return target;
}
/** Projects initialized before the .agents default keep their corpus at the repo root; move it once. */
async function migrateLegacyKnowledgeFile(root, knowledgePath) {
    const legacyPath = path.join(root, LEGACY_DEFAULT_KNOWLEDGE_FILE);
    if (legacyPath === knowledgePath)
        return;
    let legacy;
    try {
        legacy = await stat(legacyPath);
    }
    catch {
        return;
    }
    if (!legacy.isFile())
        return;
    try {
        await readFile(knowledgePath);
        return;
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    await mkdir(path.dirname(knowledgePath), { recursive: true });
    await rename(legacyPath, knowledgePath);
}
export async function ensureKnowledgeOutput(root, knowledgeFile = DEFAULT_KNOWLEDGE_FILE, contextPointer = true) {
    const knowledgePath = knowledgeFilePath(root, knowledgeFile);
    if (knowledgeFile === DEFAULT_KNOWLEDGE_FILE)
        await migrateLegacyKnowledgeFile(root, knowledgePath);
    try {
        await readFile(knowledgePath);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
        await mkdir(path.dirname(knowledgePath), { recursive: true });
        await atomicWrite(knowledgePath, renderKnowledgeMarkdown([]));
    }
    if (!contextPointer)
        return { knowledgeFile: knowledgePath };
    const contextFile = await updateContextPointer(root, knowledgeFile);
    return { knowledgeFile: knowledgePath, contextFile };
}

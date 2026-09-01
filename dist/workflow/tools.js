import { spawn } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { corpusRevision, entryDigest, parseKnowledgeMarkdown } from "../concept.js";
import { deriveProjectKey, knowledgeFilePath, loadGlobalConfig } from "../config.js";
import { loadCurationState, saveCurationState } from "../curation-state.js";
import { parseKnowledgeTransaction, validateTransactionOperations } from "../transaction.js";
import { sha256 } from "../state.js";
import { readManifest } from "./manifests.js";
export const WORKFLOW_PROMPT_VERSION = "workflow-1";
const RESULT_LIMIT = 400;
const MAX_COMMAND_TIMEOUT_MS = 180_000;
export const TREE_LIMITS = { depth: 4, entries: 400, bytes: 16_384 };
const SKIP_DIRS = new Set([
    ".git", "node_modules", "dist", "build", "out", "coverage", ".cache",
    ".agents", ".cheatcodes", ".pi-files", "vendor", ".venv", "__pycache__",
]);
const rootFor = (env) => path.resolve(env.CHEATCODES_PROJECT_ROOT ?? process.cwd());
const text = (value, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: value, ...(isError ? { isError: true } : {}) });
export async function loadCorpus(root, env) {
    const global = await loadGlobalConfig(env);
    const file = knowledgeFilePath(root, global?.knowledgeFile);
    let entries = [];
    try {
        entries = parseKnowledgeMarkdown(await readFile(file, "utf8"));
    }
    catch {
        entries = [];
    }
    return { entries, revision: corpusRevision(entries) };
}
const overlap = (haystack, terms) => terms.filter((term) => haystack.toLowerCase().includes(term));
// Depth-first with sorted names; the flat output is already lexicographic.
// Symlinks are skipped outright so the walk cannot escape the root.
async function walkTree(root, relative, depth, out, files) {
    if (depth > TREE_LIMITS.depth || out.length >= TREE_LIMITS.entries)
        return out.length >= TREE_LIMITS.entries;
    let dirents;
    try {
        dirents = await readdir(relative ? path.join(root, relative) : root, { withFileTypes: true });
    }
    catch {
        return false;
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
        if (out.length >= TREE_LIMITS.entries)
            return true;
        if (dirent.isSymbolicLink())
            continue;
        const rel = relative ? `${relative}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
            if (SKIP_DIRS.has(dirent.name))
                continue;
            out.push({ path: `${rel}/` });
            if (await walkTree(root, rel, depth + 1, out, files))
                return true;
        }
        else if (dirent.isFile()) {
            const info = await stat(path.join(root, rel)).catch(() => undefined);
            out.push({ path: rel, bytes: info?.size ?? 0 });
            files.count += 1;
        }
    }
    return false;
}
export function loadEvidenceEpisodeTool(env = process.env) {
    return defineTool({
        name: "load_evidence_episode",
        label: "Load evidence episode",
        description: "Load one harvested evidence episode from a workflow manifest. Accepts manifest and packet ids only; paths are rejected.",
        parameters: Type.Object({
            manifestId: Type.String({ description: "Content-addressed manifest id from the workflow target." }),
            packetId: Type.Optional(Type.String({ description: "Packet id inside the manifest. Omit to list the manifest's packet inventory." })),
        }, { additionalProperties: false }),
        execute: async (_toolCallId, params) => {
            const root = rootFor(env);
            const manifest = await readManifest(root, params.manifestId);
            if (!manifest)
                return text(`error: unknown manifest ${params.manifestId}`, true);
            if (params.packetId === undefined) {
                return text(manifest.packets.map((item) => ({ packetId: item.id, sessionId: item.sessionId, signals: item.signals, userIntent: item.userIntent })));
            }
            const packet = manifest.packets.find((item) => item.id === params.packetId);
            if (!packet)
                return text(`error: manifest ${params.manifestId} has no packet ${params.packetId}`, true);
            return text({
                packetId: packet.id, sessionId: packet.sessionId, closure: packet.closure, signals: packet.signals,
                signalReasons: packet.signalReasons, userIntent: packet.userIntent,
                finalAssistantSummary: packet.finalAssistantSummary, omittedEvidenceCount: packet.omittedEvidenceCount,
                evidence: packet.evidence, shortlist: packet.shortlist,
                ...(packet.updateCandidate ? { updateCandidate: packet.updateCandidate } : {}),
            });
        },
    });
}
export function searchKnowledgeTool(env = process.env) {
    return defineTool({
        name: "search_knowledge",
        label: "Search knowledge",
        description: "Search the project corpus lexically. Returns full bodies, digests, and match reasons under hard caps.",
        parameters: Type.Object({
            query: Type.String({ minLength: 2, maxLength: 300 }),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
        }, { additionalProperties: false }),
        execute: async (_toolCallId, params) => {
            const root = rootFor(env);
            const { entries, revision } = await loadCorpus(root, env);
            const terms = params.query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
            const limit = params.limit ?? 5;
            const scored = entries.map((entry) => {
                const titleHits = overlap(entry.title, terms);
                const tagHits = overlap((entry.tags ?? []).join(" "), terms);
                const bodyHits = overlap(entry.body, terms);
                const score = titleHits.length * 3 + tagHits.length * 2 + bodyHits.length;
                const reasons = [
                    ...(titleHits.length > 0 ? [`title:${titleHits.join(",")}`] : []),
                    ...(tagHits.length > 0 ? [`tags:${tagHits.join(",")}`] : []),
                    ...(bodyHits.length > 0 ? [`body:${bodyHits.length} term(s)`] : []),
                ];
                return { entry, score, reasons };
            }).filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
                .slice(0, limit);
            return text({
                corpusRevision: revision,
                results: scored.map(({ entry, reasons }) => ({
                    id: entry.id, title: entry.title, summary: entry.summary, body: entry.body,
                    digest: entryDigest(entry), matchReasons: reasons,
                })),
            });
        },
    });
}
export function inspectProjectFactTool(env = process.env) {
    return defineTool({
        name: "inspect_project_fact",
        label: "Inspect project fact",
        description: "Read lines from a file inside the verified project root. Rejects paths outside the root and symlink escapes.",
        parameters: Type.Object({
            path: Type.String({ description: "Path relative to the project root." }),
            pattern: Type.Optional(Type.String({ maxLength: 200, description: "Only return lines containing this text." })),
            maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: RESULT_LIMIT })),
        }, { additionalProperties: false }),
        execute: async (_toolCallId, params) => {
            const root = rootFor(env);
            const absolute = path.resolve(root, params.path);
            const rootReal = await realpath(root).catch(() => root);
            const targetReal = await realpath(absolute).catch(() => absolute);
            if (!targetReal.startsWith(rootReal + path.sep) && targetReal !== rootReal) {
                return text(`error: path escapes the project root`, true);
            }
            let content;
            try {
                content = await readFile(targetReal, "utf8");
            }
            catch {
                return text(`error: cannot read ${params.path}`, true);
            }
            const allLines = content.split("\n");
            const cap = params.maxLines ?? 80;
            let lines = allLines.map((lineText, index) => ({ line: index + 1, text: lineText }));
            const total = lines.length;
            if (params.pattern) {
                const needle = params.pattern.toLowerCase();
                lines = lines.filter((item) => item.text.toLowerCase().includes(needle));
            }
            const truncated = lines.length > cap;
            return text({ path: params.path, sha256: sha256(content), totalLines: total, matchedLines: lines.length, truncated, lines: lines.slice(0, cap) });
        },
    });
}
export function inspectProjectTreeTool(env = process.env) {
    return defineTool({
        name: "inspect_project_tree",
        label: "Inspect project tree",
        description: "Bounded inventory of the verified project root: relative paths with file sizes. Skips dependency, build, and metadata directories. Caps depth and entry count.",
        parameters: Type.Object({}, { additionalProperties: false }),
        execute: async () => {
            const root = rootFor(env);
            const rootReal = await realpath(root).catch(() => root);
            const entries = [];
            const files = { count: 0 };
            const hitCap = await walkTree(rootReal, "", 0, entries, files);
            const render = (list, truncated) => JSON.stringify({ root: path.basename(rootReal), totalFiles: files.count, truncated, entries: list });
            let list = entries;
            let truncated = hitCap;
            while (render(list, truncated).length > TREE_LIMITS.bytes && list.length > 0) {
                list = list.slice(0, Math.floor(list.length * 0.9));
                truncated = true;
            }
            return text({ root: path.basename(rootReal), totalFiles: files.count, truncated, entries: list });
        },
    });
}
export function verifyCommandTool(env = process.env) {
    return defineTool({
        name: "verify_command",
        label: "Verify command",
        description: "Run an allowlisted verification command by id. The host builds the argument vector; shell text is never accepted.",
        parameters: Type.Object({ commandId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
        execute: async (_toolCallId, params) => {
            const root = rootFor(env);
            let allowlist;
            try {
                allowlist = JSON.parse(await readFile(path.join(root, ".cheatcodes", "workflow", "commands.json"), "utf8"));
            }
            catch {
                return text("error: no verification command allowlist is configured", true);
            }
            const entry = allowlist[params.commandId];
            if (!entry || !Array.isArray(entry.argv) || entry.argv.length === 0 || !entry.argv.every((part) => typeof part === "string")) {
                return text(`error: command id ${params.commandId} is not allowlisted`, true);
            }
            const timeoutMs = Math.min(entry.timeoutMs ?? 120_000, MAX_COMMAND_TIMEOUT_MS);
            return await new Promise((resolve) => {
                const child = spawn(entry.argv[0], entry.argv.slice(1), { cwd: root, timeout: timeoutMs, killSignal: "SIGTERM", stdio: ["ignore", "pipe", "pipe"] });
                let out = "";
                let err = "";
                let timedOut = false;
                child.stdout.on("data", (chunk) => { if (out.length < 65_536)
                    out += String(chunk); });
                child.stderr.on("data", (chunk) => { if (err.length < 65_536)
                    err += String(chunk); });
                child.on("error", (error) => resolve(text({ commandId: params.commandId, status: "spawn-failed", error: String(error) }, true)));
                child.on("exit", (code, signal) => {
                    if (signal === "SIGTERM" || signal === "SIGKILL")
                        timedOut = true;
                    resolve(text({
                        commandId: params.commandId, status: timedOut ? "timeout" : "exited",
                        exitCode: code, timedOut,
                        stdoutTail: out.slice(-4_000), stderrTail: err.slice(-4_000),
                    }));
                });
            });
        },
    });
}
export function stageKnowledgeTransactionTool(env = process.env) {
    return defineTool({
        name: "stage_knowledge_transaction",
        label: "Stage knowledge transaction",
        description: "Revalidate a challenged transaction against the live corpus and stage it into host state. Never edits the corpus; the host applies staged work only after terminal workflow success.",
        parameters: Type.Object({
            transaction: Type.Object({
                baseRevision: Type.String({ minLength: 1 }),
                packetIds: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
                operations: Type.Array(Type.Object({ op: Type.String() }, { additionalProperties: true }), { minItems: 1, maxItems: 8 }),
            }, { additionalProperties: false }),
        }, { additionalProperties: false }),
        execute: async (_toolCallId, params) => {
            const root = rootFor(env);
            const projectKey = await deriveProjectKey(root);
            const { entries, revision } = await loadCorpus(root, env);
            if (params.transaction.baseRevision !== revision) {
                return text({ status: "rejected", reason: "stale-revision", currentRevision: revision }, true);
            }
            const candidate = {
                transactionId: `wf-${sha256(JSON.stringify([projectKey, revision, params.transaction.operations])).slice(0, 24)}`,
                projectKey,
                baseRevision: params.transaction.baseRevision,
                packetIds: params.transaction.packetIds ?? [],
                promptVersion: WORKFLOW_PROMPT_VERSION,
                modelId: "workflow",
                operations: params.transaction.operations,
                createdAt: new Date().toISOString(),
            };
            let transaction;
            try {
                transaction = parseKnowledgeTransaction(candidate);
            }
            catch (error) {
                return text({ status: "rejected", reason: "schema", detail: String(error).slice(0, 600) }, true);
            }
            const { issues } = validateTransactionOperations(entries, transaction.operations, projectKey);
            if (issues.length > 0)
                return text({ status: "rejected", reason: "validation", issues: issues.slice(0, 8) }, true);
            const state = await loadCurationState(env, projectKey);
            await saveCurationState(env, {
                ...state,
                maintenanceCursor: { at: new Date().toISOString(), lastTransactionId: state.maintenanceCursor?.lastTransactionId, pendingTransaction: transaction },
            });
            return text({ status: "staged", transactionId: transaction.transactionId, baseRevision: revision, digest: sha256(JSON.stringify(transaction.operations)) });
        },
    });
}
export function createWorkflowTools(env = process.env) {
    return [loadEvidenceEpisodeTool(env), searchKnowledgeTool(env), inspectProjectFactTool(env), verifyCommandTool(env), stageKnowledgeTransactionTool(env)];
}

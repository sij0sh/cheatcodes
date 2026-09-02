import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { entryDigest } from "../concept.js";
import { maintainProject } from "../maintain.js";
import { buildManifest, commitManifestCursors, readManifest } from "./manifests.js";
import { loadCorpus, writePendingTransaction } from "./tools.js";
const defaultLauncher = async ({ root, target }) => {
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
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function injectLiveDigests(op, digests) {
    if (!isRecord(op))
        return op;
    const next = { ...op };
    if (isRecord(next.target) && typeof next.target.id === "string" && digests.has(next.target.id)) {
        next.target = { ...next.target, expectedDigest: digests.get(next.target.id) };
    }
    if (Array.isArray(next.targets)) {
        next.targets = next.targets.map((target) => {
            if (!isRecord(target) || typeof target.id !== "string" || !digests.has(target.id))
                return target;
            return { ...target, expectedDigest: digests.get(target.id) };
        });
    }
    return next;
}
/**
 * The workflow agent is read-only, so the host performs the staging the old
 * tool call performed. Digests are injected from the live corpus because a
 * read-only agent cannot compute them; the baseRevision check keeps the
 * optimistic-concurrency guard against corpus changes since the manifest.
 */
export async function stageChallengedTransaction(options) {
    const data = options.challenged;
    if (!isRecord(data))
        return { staged: false, warning: "workflow completed without a challenge decision" };
    if (data.decision === "rejected") {
        const rationale = typeof data.rationale === "string" ? data.rationale : "no rationale";
        return { staged: false, warning: `challenger rejected the transaction: ${rationale}` };
    }
    const proposed = isRecord(data.transaction) ? data.transaction : undefined;
    if (!proposed || !Array.isArray(proposed.operations) || proposed.operations.length === 0) {
        return { staged: false, warning: "challenge decision carries no transaction operations" };
    }
    const { entries, revision } = await loadCorpus(options.root, options.env);
    if (proposed.baseRevision !== revision) {
        return { staged: false, warning: `stale transaction base revision (${String(proposed.baseRevision)}); corpus is at ${revision}` };
    }
    const digests = new Map(entries.map((entry) => [entry.id, entryDigest(entry)]));
    const operations = proposed.operations.map((op) => injectLiveDigests(op, digests));
    const packetIds = Array.isArray(proposed.packetIds) ? proposed.packetIds.filter((id) => typeof id === "string") : [];
    const staged = await writePendingTransaction(options.env, options.manifest.projectKey, entries, String(proposed.baseRevision), packetIds, operations);
    if (!staged.ok)
        return { staged: false, warning: `transaction not staged (${staged.reason}${staged.detail ? `: ${staged.detail}` : ""})` };
    return { staged: true };
}
/**
 * The engine stamps every snapshot into its session JSONL. A run counts as
 * terminal success only when the newest choreograph snapshot reports
 * `completed`; parked or missing reports never apply staged work.
 */
export async function findTerminalReport(env, root, sinceMs, manifestId) {
    const sessionsRoot = path.join(env.PI_CODING_AGENT_DIR ?? getAgentDir(), "sessions");
    const candidates = [];
    const walk = async (directory, depth) => {
        if (depth > 3)
            return;
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory())
                await walk(target, depth + 1);
            else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
                const info = await stat(target).catch(() => undefined);
                if (info && info.mtimeMs >= sinceMs - 1_000)
                    candidates.push({ file: target, mtimeMs: info.mtimeMs });
            }
        }
    };
    await walk(sessionsRoot, 0);
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const candidate of candidates.slice(0, 8)) {
        const content = await readFile(candidate.file, "utf8").catch(() => "");
        let cwdMatches = false;
        let status = "unknown";
        let challenged;
        for (const line of content.split("\n")) {
            if (!line.trim())
                continue;
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (!isRecord(parsed))
                continue;
            if (!cwdMatches && parsed.type === "session" && typeof parsed.cwd === "string" && path.resolve(parsed.cwd) === root)
                cwdMatches = true;
            if (parsed.type === "custom" && parsed.customType === "choreograph" && isRecord(parsed.data) && typeof parsed.data.status === "string") {
                const execution = isRecord(parsed.data.execution) ? parsed.data.execution : undefined;
                // A concurrent workflow in the same project must never satisfy this run's terminal check.
                if (manifestId !== undefined) {
                    if (parsed.data.workflow !== "cheatcodes-curate" || execution?.target !== manifestId)
                        continue;
                }
                if (parsed.data.status === "parked")
                    status = "parked";
                else if (parsed.data.status === "completed") {
                    status = "completed";
                    const results = execution && isRecord(execution.results) ? execution.results : undefined;
                    const challenge = results && isRecord(results.challenge) ? results.challenge : undefined;
                    if (challenge && "data" in challenge)
                        challenged = challenge.data;
                }
                // In-progress snapshots (active, rollover-pending) never satisfy the check.
            }
        }
        if (cwdMatches)
            return { status, sessionFile: candidate.file, challenged };
    }
    return { status: "unknown" };
}
export async function runWorkflowCurator(options = {}) {
    const env = options.env ?? process.env;
    const root = path.resolve(options.root ?? process.cwd());
    const warnings = [];
    const startedAt = Date.now();
    const build = await buildManifest({ root, env });
    warnings.push(...build.warnings);
    if (!build.manifest)
        return { started: false, warning: "no pending episodes to curate", warnings };
    const manifest = build.manifest;
    const launcher = options.launcher ?? defaultLauncher;
    const launched = await launcher({ root, target: manifest.id });
    if (launched.exitCode === 127)
        return { started: false, manifestId: manifest.id, warning: "pi CLI is not available; install choreograph and pi to run the curation workflow", warnings };
    const terminal = await findTerminalReport(env, root, startedAt, manifest.id);
    if (terminal.status !== "completed") {
        return { started: true, manifestId: manifest.id, terminal, warning: `workflow did not complete (${terminal.status}); staged work is left pending and cursors are not committed`, warnings };
    }
    const staging = await stageChallengedTransaction({ env, root, manifest, challenged: terminal.challenged });
    if (!staging.staged) {
        return { started: true, manifestId: manifest.id, terminal, warning: staging.warning ?? "workflow completed without staging a transaction", warnings };
    }
    const outcome = await maintainProject({ env, root, mode: "resume" });
    if (outcome.warning)
        return { started: true, manifestId: manifest.id, terminal, warning: outcome.warning, warnings };
    if (!outcome.committed)
        return { started: true, manifestId: manifest.id, terminal, warning: "nothing was committed", warnings };
    const committedCursors = await commitManifestCursors({ env, root, manifest });
    warnings.push(`committed ${committedCursors} source cursor(s)`);
    return { started: true, manifestId: manifest.id, terminal, applied: outcome.committed, warnings };
}
export async function loadManifestForReplay(root, manifestId) {
    return await readManifest(root, manifestId);
}

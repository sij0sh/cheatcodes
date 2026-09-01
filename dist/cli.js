#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { maintenanceSchedule, maintainProject } from "./maintain.js";
import { runMap } from "./map.js";
import { projectStatus, runWorker } from "./run.js";
import { runWorkflowCurator } from "./workflow/runner.js";
const MAINTENANCE_FLAGS = new Set(["--dry-run", "--apply", "--resume"]);
function usage() {
    return [
        "Usage:",
        "  cheatcodes run",
        "  cheatcodes status",
        "  cheatcodes map [--root <dir>] [--dry-run]",
        "  cheatcodes maintain [--root <dir>] [--dry-run|--apply|--resume]",
        "  cheatcodes workflow [--root <dir>]",
    ].join("\n");
}
function parseMaintainArgs(rest) {
    let mode = "dry-run";
    let root;
    for (let index = 0; index < rest.length; index++) {
        const arg = rest[index];
        if (arg === "--root") {
            const value = rest[++index];
            if (!value)
                return { error: "--root requires a directory" };
            if (root !== undefined)
                return { error: "--root given more than once" };
            root = value;
            continue;
        }
        if (MAINTENANCE_FLAGS.has(arg)) {
            if (mode !== "dry-run")
                return { error: "choose only one of --dry-run, --apply, --resume" };
            mode = arg === "--apply" ? "apply" : arg === "--resume" ? "resume" : "dry-run";
            continue;
        }
        return { error: `unknown maintenance option: ${arg}` };
    }
    return { mode, root };
}
function renderPlan(plan) {
    if (!plan)
        return [];
    const lines = [
        `Maintenance plan for ${plan.projectKey} (base revision ${plan.baseRevision.slice(0, 12)}):`,
        `Reviewed (verified): ${plan.reviewedIds.length > 0 ? plan.reviewedIds.join(", ") : "none"}`,
        `Proposed operations: ${plan.operations.length}`,
    ];
    for (const op of plan.operations) {
        if (op.op === "merge")
            lines.push(`  - merge ${op.targets.map((target) => target.id).join(", ")} into ${op.survivorId} (${op.reason})`);
        else if (op.op === "needs-review")
            lines.push(`  - needs-review ${op.targets.join(", ")}: ${op.conflict}`);
        else if (op.op === "delete")
            lines.push(`  - delete ${op.target.id} (${op.reason})`);
        else if (op.op === "create")
            lines.push(`  - create entry "${op.entry.title}"`);
        else if (op.op === "update")
            lines.push(`  - update ${op.target.id}`);
        else if (op.op === "keep")
            lines.push(`  - keep ${op.target.id} (${op.reason})`);
    }
    if (plan.clusters.length > 0) {
        lines.push("Contradictions:");
        for (const cluster of plan.clusters.filter((candidate) => candidate.kind === "contradiction")) {
            lines.push(`  - ${cluster.entryIds.join(", ")}: ${cluster.reasons.join("; ")}`);
        }
    }
    else {
        lines.push("Contradictions: none");
    }
    lines.push(`Missing verification: ${plan.missingVerification.length > 0 ? plan.missingVerification.map((item) => item.id).join(", ") : "none"}`);
    lines.push(`Resulting entries: ${plan.resultingCount}`);
    return lines;
}
export async function main(args = process.argv.slice(2)) {
    const [command, ...rest] = args;
    if (!command || command === "help" || command === "--help" || command === "-h") {
        console.log(usage());
        if (!command)
            process.exitCode = 2;
        return;
    }
    if (command === "maintain") {
        const parsed = parseMaintainArgs(rest);
        if ("error" in parsed) {
            console.error(`cheatcodes maintain: ${parsed.error}`);
            console.error(usage());
            process.exitCode = 2;
            return;
        }
        try {
            const schedule = await maintenanceSchedule(process.env, parsed.root ? path.resolve(parsed.root) : process.cwd());
            console.log(`Maintenance ${schedule.due ? "due" : "not due"}${schedule.reasons.length > 0 ? `: ${schedule.reasons.join("; ")}` : ""}.`);
            const outcome = await maintainProject({ mode: parsed.mode, root: parsed.root ? path.resolve(parsed.root) : undefined });
            for (const line of renderPlan(outcome.plan))
                console.log(line);
            if (outcome.warning)
                console.warn(`warning: ${outcome.warning}`);
            if (outcome.committed) {
                console.log(`Applied ${outcome.committed.transactionId}: ${outcome.committed.entryCountBefore} -> ${outcome.committed.entryCountAfter} entries, ${outcome.committed.tombstones} tombstone(s), ${outcome.committed.reviews} review(s), revision ${outcome.committed.resultRevision.slice(0, 12)}.`);
            }
        }
        catch (error) {
            console.error(`cheatcodes maintain: ${error.message}`);
            process.exitCode = 1;
        }
        return;
    }
    if (command === "workflow") {
        let root;
        for (let index = 0; index < rest.length; index++) {
            const arg = rest[index];
            if (arg === "--root") {
                root = rest[++index];
                if (!root) {
                    console.error("cheatcodes workflow: --root requires a directory");
                    process.exitCode = 2;
                    return;
                }
                continue;
            }
            console.error(`cheatcodes workflow: unknown option ${arg}`);
            process.exitCode = 2;
            return;
        }
        try {
            const result = await runWorkflowCurator(root ? { root: path.resolve(root) } : {});
            for (const warning of result.warnings)
                console.warn(`warning: ${warning}`);
            if (!result.started) {
                console.log(`cheatcodes workflow: nothing to curate${result.warning ? ` (${result.warning})` : ""}`);
                return;
            }
            console.log(`cheatcodes workflow: manifest ${result.manifestId}, terminal ${result.terminal?.status ?? "unknown"}.`);
            if (result.warning)
                console.warn(`warning: ${result.warning}`);
            if (result.applied) {
                console.log(`Applied ${result.applied.transactionId}: ${result.applied.entryCountBefore} -> ${result.applied.entryCountAfter} entries, ${result.applied.tombstones} tombstone(s), ${result.applied.reviews} review(s).`);
            }
            if (result.terminal && result.terminal.status !== "completed")
                process.exitCode = 1;
        }
        catch (error) {
            console.error(`cheatcodes workflow: ${error.message}`);
            process.exitCode = 1;
        }
        return;
    }
    if (command === "map") {
        let root;
        let dryRun = false;
        for (let index = 0; index < rest.length; index++) {
            const arg = rest[index];
            if (arg === "--root") {
                root = rest[++index];
                if (!root) {
                    console.error("cheatcodes map: --root requires a directory");
                    process.exitCode = 2;
                    return;
                }
                continue;
            }
            if (arg === "--dry-run") {
                dryRun = true;
                continue;
            }
            console.error(`cheatcodes map: unknown option ${arg}`);
            console.error(usage());
            process.exitCode = 2;
            return;
        }
        try {
            const result = await runMap({ root: root ? path.resolve(root) : undefined, dryRun });
            if (result.warning)
                console.warn(`warning: ${result.warning}`);
            for (const line of result.planned ?? [])
                console.log(`  - ${line}`);
            if (result.committed) {
                console.log(`Applied ${result.committed.transactionId}: ${result.committed.entryCountBefore} -> ${result.committed.entryCountAfter} entries, revision ${result.committed.resultRevision.slice(0, 12)}.`);
            }
            if (result.status === "failed")
                process.exitCode = 1;
        }
        catch (error) {
            console.error(`cheatcodes map: ${error.message}`);
            process.exitCode = 1;
        }
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
            for (const warning of result.run.warnings)
                console.warn(`warning: ${warning}`);
            console.log(`Processed ${result.run.changedFiles} changed file(s), ${result.run.curatorCalls} curator call(s), ${result.run.entriesWritten} entry write(s).`);
        }
        else {
            console.log(`cheatcodes ${command}: ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`);
        }
    }
    else if (command === "status") {
        const result = await projectStatus();
        console.log(`Project ${result.projectKey} at ${result.root}`);
        console.log(`Inputs: ${result.discoveredFiles} session file(s) discovered, ${result.skipped.length} skipped, ${result.missingInputs.length} missing input(s).`);
        console.log(`Entries: ${result.entries} in ${result.knowledgeFile}.`);
        if (result.lastRun) {
            console.log(`Last run: ${result.lastRun.outcome}${result.lastRun.reason ? ` (${result.lastRun.reason})` : ""} at ${result.lastRun.finishedAt}.`);
        }
        else {
            console.log("Last run: none recorded.");
        }
    }
    else {
        console.error(`cheatcodes: unknown command "${command}"`);
        console.error(usage());
        process.exitCode = 2;
    }
}
const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked)
    main().catch((error) => { console.error(`cheatcodes: ${error.message}`); process.exitCode = 1; });

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { globalStatePath } from "./state.js";
export function curationMetricsPath(env = process.env) {
    return path.join(path.dirname(globalStatePath(env)), "curation-metrics.jsonl");
}
export async function recordCurationMetrics(record, env = process.env) {
    try {
        const file = curationMetricsPath(env);
        await mkdir(path.dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify(record)}\n`);
        return true;
    }
    catch {
        return false;
    }
}

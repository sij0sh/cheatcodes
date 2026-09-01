import { spawn as nodeSpawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { loadGlobalConfig } from "../config.js";
import { createWorkflowTools } from "./tools.js";
export function defaultResolveCli() {
    return createRequire(import.meta.url).resolve("cheatcodes/cli");
}
/** Tool registration defaults to on; `tools: false` in the global config hides the tools. */
export async function toolsEnabled(loadConfig = loadGlobalConfig) {
    try {
        const config = await loadConfig();
        return config?.tools !== false;
    }
    catch {
        // Config errors must never block session start; default to exposing the tools.
        return true;
    }
}
/** Autorun defaults to on; an explicit `autorun: false` in the global config disables it. */
export async function autorunEnabled(loadConfig = loadGlobalConfig) {
    try {
        const config = await loadConfig();
        return config?.autorun !== false;
    }
    catch {
        // Config errors must never block session start; the worker reports them itself.
        return true;
    }
}
export function launchAutorun(pi, deps) {
    pi.on("session_start", (event, ctx) => {
        if (event.reason === "reload")
            return;
        if (!ctx.isProjectTrusted())
            return;
        return runAutorun(event, ctx, deps);
    });
}
async function runAutorun(event, ctx, deps) {
    if (process.env.CHEATCODES_ENSURE === "0")
        return;
    if (!(await autorunEnabled(deps.loadConfig)))
        return;
    let cliPath;
    try {
        cliPath = deps.resolveCli();
    }
    catch {
        return;
    }
    const env = { ...process.env };
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile)
        env.CHEATCODES_PI_SESSION_FILE = sessionFile;
    if (event.previousSessionFile)
        env.CHEATCODES_PI_PREVIOUS_SESSION_FILE = event.previousSessionFile;
    if (ctx.model)
        env.CHEATCODES_PI_MODEL = `${ctx.model.provider}/${ctx.model.id}`;
    if (ctx.thinkingLevel)
        env.CHEATCODES_PI_THINKING = ctx.thinkingLevel;
    const timeout = env.CHEATCODES_ENSURE_TIMEOUT?.trim() || "120";
    try {
        const child = deps.spawn(process.execPath, [cliPath, "ensure", "--timeout", timeout], {
            cwd: ctx.cwd,
            detached: true,
            shell: false,
            stdio: "ignore",
            env,
        });
        child.unref();
        child.on("error", (error) => {
            // Diagnosable, never silent: missing binary, permissions, spawn errors.
            try {
                appendFileSync(join(ctx.cwd, ".cheatcodes-ensure.log"), `${new Date().toISOString()} cheatcodes ensure spawn failed: ${error.message}\n`);
            }
            catch {
                // A failed log write must never break a session.
            }
        });
    }
    catch {
        // A missing or failing CLI never breaks a session.
    }
}
/** Pi extension entry: bounded curation tools plus optional session-start autorun. */
export default async function cheatcodesExtension(pi, deps = {}) {
    const showTools = deps.tools ?? (await toolsEnabled(deps.loadConfig));
    if (showTools) {
        for (const tool of createWorkflowTools())
            pi.registerTool(tool);
    }
    if (deps.autorun === false)
        return;
    launchAutorun(pi, {
        spawn: deps.spawn ?? nodeSpawn,
        resolveCli: deps.resolveCli ?? defaultResolveCli,
        loadConfig: deps.loadConfig ?? loadGlobalConfig,
    });
}

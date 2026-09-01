import { readFileSync } from "node:fs";
import path from "node:path";
import { getAgentDir, SessionManager, SettingsManager, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { loadGlobalConfig } from "../config.js";
import cheatcodesWorkflow from "./extension.js";
const isRecord = (value) => typeof value === "object" && value !== null;
/**
 * Drives the choreograph workflow in a real SDK session. `pi -p` cannot run
 * this workflow: it disposes the session when the triggering turn ends, while
 * the engine still drives steps across turns. The SDK runtime stays alive and
 * rebinds extensions across the engine's session rollovers.
 */
export async function main(argv = process.argv.slice(2)) {
    const manifestId = argv[0]?.trim();
    if (!manifestId) {
        console.error("usage: node dist/workflow/headless.js <manifest-id>");
        process.exitCode = 2;
        return;
    }
    const cwd = process.cwd();
    // The worker is repo-scoped: in-memory settings keep the user's global
    // packages (including any globally installed workflow engine) out of the
    // session, and the engine is bound to this project's own .agents/workflows.
    const extensionSuffix = import.meta.filename?.endsWith(".ts") ? "ts" : "js";
    const projectWorkflowsExtension = path.join(import.meta.dirname ?? ".", `workflows-extension.${extensionSuffix}`);
    // The SDK leaves extension binding to the host: without bindExtensions the
    // session_start event never reaches package extensions, so a rollover child
    // never restores its run. The stub must be a real object: the runner spreads
    // the UI, which drops Proxy traps and made every ui call throw.
    const noop = () => { };
    const headlessUi = {
        select: async () => undefined,
        confirm: async () => false,
        input: async () => undefined,
        notify: (message, level) => console.error(`cheatcodes workflow: ${level ?? "info"}: ${message}`),
        onTerminalInput: () => noop,
        setStatus: noop,
        setWorkingMessage: noop,
        setWorkingVisible: noop,
        setWorkingIndicator: noop,
        setHiddenThinkingLabel: noop,
        setWidget: noop,
        setFooter: noop,
        setHeader: noop,
        setTitle: noop,
        custom: async () => undefined,
        pasteToEditor: noop,
        setEditorText: noop,
        getEditorText: () => "",
        editor: async () => undefined,
        addAutocompleteProvider: noop,
        setEditorComponent: noop,
        getEditorComponent: () => undefined,
        getAllThemes: () => [],
        setTheme: () => ({ success: true }),
        getToolsExpanded: () => false,
        setToolsExpanded: noop,
        theme: { name: "headless" },
        getTheme: () => undefined,
    };
    const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
        const services = await createAgentSessionServices({
            cwd,
            settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
            // The bounded tools must exist even when project-package discovery is
            // unavailable, so the engine can grant them to each workflow position.
            resourceLoaderOptions: {
                extensionFactories: [{ name: "cheatcodes-tools", factory: (pi) => cheatcodesWorkflow(pi, { autorun: false, tools: true }) }],
                additionalExtensionPaths: [projectWorkflowsExtension],
            },
        });
        const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
        console.error(`cheatcodes workflow: constructed session for ${sessionManager.getSessionFile()}`);
        await result.session.bindExtensions({
            uiContext: headlessUi,
            mode: "print",
            onError: (error) => console.error(`cheatcodes workflow: extension error (${error.extensionPath}): ${error.error}`),
        });
        console.error("cheatcodes workflow: extensions bound");
        return {
            ...result,
            services,
            diagnostics: services.diagnostics,
        };
    };
    const runtime = await createAgentSessionRuntime(createRuntime, {
        cwd,
        agentDir: getAgentDir(),
        sessionManager: SessionManager.create(cwd),
    });
    // The SDK builds sessions without command-context actions, so the engine's
    // ctx.switchSession (used by workflow rollovers) would silently no-op —
    // the TUI/CLI modes are the only hosts that wire it. Map the commands to
    // this runtime; rebind for every session a rollover creates.
    const wireEngineCommands = () => {
        runtime.session.extensionRunner.bindCommandContext({
            waitForIdle: () => runtime.session.waitForIdle(),
            newSession: (options) => runtime.newSession(options),
            fork: (entryId, options) => runtime.fork(entryId, options),
            navigateTree: (entryId, options) => runtime.session.navigateTree(entryId, options),
            switchSession: (sessionPath, options) => runtime.switchSession(sessionPath, options),
            reload: () => runtime.session.reload(),
        });
    };
    wireEngineCommands();
    console.error(`cheatcodes workflow: runtime ready, session ${runtime.session.sessionFile}`);
    const global = await loadGlobalConfig();
    const timeoutMs = (global?.workerTimeoutMinutes ?? 10) * 60_000;
    // Pi's SDK default is a small fast model; a rollover child resumes from the
    // engine's bare control message in a fresh context, which needs the stronger
    // configured model to actually continue the position's work.
    if (global?.model) {
        const slash = global.model.indexOf("/");
        const provider = slash === -1 ? undefined : global.model.slice(0, slash);
        const rest = slash === -1 ? global.model : global.model.slice(slash + 1);
        const colon = rest.lastIndexOf(":");
        const suffix = colon === -1 ? undefined : rest.slice(colon + 1);
        const thinking = suffix && ["off", "minimal", "low", "medium", "high"].includes(suffix) ? suffix : undefined;
        const modelId = colon === -1 || thinking ? (colon === -1 ? rest : rest.slice(0, colon)) : rest;
        const model = provider ? runtime.session.modelRuntime.getModel(provider, modelId) : runtime.session.modelRuntime.getModel("", modelId);
        if (!model && provider) {
            // The suffix may be part of the model id.
            try {
                const fallback = runtime.session.modelRuntime.getModel(provider, rest);
                if (fallback)
                    await runtime.session.setModel(fallback);
            }
            catch (error) {
                console.error(`cheatcodes workflow: configured model "${global.model}" unusable: ${error.message}`);
            }
        }
        if (model) {
            try {
                await runtime.session.setModel(model);
                if (thinking)
                    runtime.session.setThinkingLevel(thinking);
            }
            catch (error) {
                console.error(`cheatcodes workflow: configured model "${global.model}" unusable: ${error.message}`);
            }
        }
        else if (!provider) {
            console.error(`cheatcodes workflow: configured model "${global.model}" not found; using session default`);
        }
    }
    let pumpedFile = runtime.session.sessionFile;
    const timer = setTimeout(() => {
        console.error(`cheatcodes workflow: worker timed out after ${global?.workerTimeoutMinutes ?? 10} minute(s)`);
        void runtime.session.abort();
    }, timeoutMs);
    try {
        console.error(`cheatcodes workflow: starting run ${manifestId}`);
        await runtime.session.prompt(`/cheatcodes-curate ${manifestId}`);
        console.error("cheatcodes workflow: initial prompt resolved");
    }
    catch (error) {
        console.error(`cheatcodes workflow: worker failed: ${error.message}`);
        process.exitCode = 1;
        return;
    }
    // The prompt resolves at the engine's first session rollover; the run keeps
    // going in child sessions, so stay alive until a terminal snapshot lands.
    // A rebinding to a non-terminal child stalls it: in headless mode nothing
    // pumps the child's first turn (in the TUI the user is the kick), so the
    // launcher kicks each fresh child once, mirroring the engine's own message.
    const deadline = Date.now() + timeoutMs;
    let report = { status: "unknown" };
    while (Date.now() < deadline) {
        report = terminalReport(runtime);
        if (report.status === "completed" || report.status === "parked")
            break;
        if (report.sessionFile && report.sessionFile !== pumpedFile) {
            pumpedFile = report.sessionFile;
            console.error(`cheatcodes workflow: session switched to ${report.sessionFile}`);
            wireEngineCommands();
            if (runtime.session.pendingMessageCount === 0 && report.runId && report.positionKey) {
                const kick = `Continue workflow \`${report.runId}\` at ${report.positionKey} (attempt ${report.attempt ?? 1}).`;
                await runtime.session.prompt(kick, { streamingBehavior: "followUp" });
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    clearTimeout(timer);
    console.log(JSON.stringify(report));
    if (report.status !== "completed")
        process.exitCode = 1;
}
function terminalReport(runtime) {
    const file = runtime.session.sessionFile;
    if (!file)
        return { status: "unknown" };
    let status = "unknown";
    let runId;
    let positionKey;
    let attempt;
    // Rollover can replace the session file between prompt resolution and this read.
    let content;
    try {
        content = readFileSync(file, "utf8");
    }
    catch {
        return { status, sessionFile: file };
    }
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
        if (!isRecord(parsed) || parsed.type !== "custom" || parsed.customType !== "choreograph" || !isRecord(parsed.data))
            continue;
        if (parsed.data.workflow !== "cheatcodes-curate")
            continue;
        if (parsed.data.status === "completed")
            status = "completed";
        else if (parsed.data.status === "parked")
            status = "parked";
        else if (typeof parsed.data.status === "string")
            status = "active";
        const execution = isRecord(parsed.data.execution) ? parsed.data.execution : undefined;
        if (execution && typeof execution.runId === "string" && Array.isArray(execution.stack) && execution.stack.length > 0) {
            const top = execution.stack[execution.stack.length - 1];
            if (isRecord(top) && typeof top.key === "string") {
                runId = execution.runId;
                positionKey = top.key;
                attempt = typeof top.attempt === "number" ? top.attempt : 1;
            }
        }
    }
    return { status, sessionFile: file, runId, positionKey, attempt };
}
const invoked = process.argv[1] && process.argv[1].endsWith("headless.js");
if (invoked)
    main().catch((error) => { console.error(`cheatcodes workflow: ${error.message}`); process.exitCode = 1; });

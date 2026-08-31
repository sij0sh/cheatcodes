import { spawn as nodeSpawn } from "node:child_process";
import { createRequire } from "node:module";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { loadGlobalConfig } from "../config.js";
import { createWorkflowTools } from "./tools.js";

export interface AutorunDeps {
	spawn?: typeof nodeSpawn;
	resolveCli?: () => string;
	loadConfig?: typeof loadGlobalConfig;
}

export function defaultResolveCli(): string {
	return createRequire(import.meta.url).resolve("cheatcodes/cli");
}

/** Autorun defaults to on; an explicit `autorun: false` in the global config disables it. */
export async function autorunEnabled(loadConfig: typeof loadGlobalConfig = loadGlobalConfig): Promise<boolean> {
	try {
		const config = await loadConfig();
		return config?.autorun !== false;
	} catch {
		// Config errors must never block session start; the worker reports them itself.
		return true;
	}
}

export function launchAutorun(
	pi: ExtensionAPI,
	deps: Required<Pick<AutorunDeps, "spawn" | "resolveCli">> & { loadConfig: typeof loadGlobalConfig },
): void {
	pi.on("session_start", (event, ctx) => {
		if (event.reason === "reload") return;
		if (!ctx.isProjectTrusted()) return;
		void (async () => {
			if (!(await autorunEnabled(deps.loadConfig))) return;
			let cliPath: string;
			try {
				cliPath = deps.resolveCli();
			} catch {
				return;
			}
			const env: NodeJS.ProcessEnv = { ...process.env };
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (sessionFile) env.CHEATCODES_PI_SESSION_FILE = sessionFile;
			if (event.previousSessionFile) env.CHEATCODES_PI_PREVIOUS_SESSION_FILE = event.previousSessionFile;
			if (ctx.model) env.CHEATCODES_PI_MODEL = `${ctx.model.provider}/${ctx.model.id}`;
			if (ctx.thinkingLevel) env.CHEATCODES_PI_THINKING = ctx.thinkingLevel;
			try {
				const child = deps.spawn(process.execPath, [cliPath, "run"], {
					cwd: ctx.cwd,
					detached: true,
					shell: false,
					stdio: "ignore",
					env,
				});
				child.unref();
				child.on("error", () => {});
			} catch {
				// A missing or failing CLI never breaks a session.
			}
		})();
	});
}

/** Pi extension entry: bounded curation tools plus optional session-start autorun. */
export default function cheatcodesExtension(pi: ExtensionAPI, deps: AutorunDeps = {}): void {
	for (const tool of createWorkflowTools() as ToolDefinition[]) pi.registerTool(tool);
	launchAutorun(pi, {
		spawn: deps.spawn ?? nodeSpawn,
		resolveCli: deps.resolveCli ?? defaultResolveCli,
		loadConfig: deps.loadConfig ?? loadGlobalConfig,
	});
}

import { spawn as nodeSpawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadGlobalConfig } from "../config.js";
export interface AutorunDeps {
    spawn?: typeof nodeSpawn;
    resolveCli?: () => string;
    loadConfig?: typeof loadGlobalConfig;
    /** Set false for embedded hosts (the workflow worker already runs curation itself). */
    autorun?: boolean;
}
export declare function defaultResolveCli(): string;
/** Autorun defaults to on; an explicit `autorun: false` in the global config disables it. */
export declare function autorunEnabled(loadConfig?: typeof loadGlobalConfig): Promise<boolean>;
export declare function launchAutorun(pi: ExtensionAPI, deps: Required<Pick<AutorunDeps, "spawn" | "resolveCli">> & {
    loadConfig: typeof loadGlobalConfig;
}): void;
/** Pi extension entry: bounded curation tools plus optional session-start autorun. */
export default function cheatcodesExtension(pi: ExtensionAPI, deps?: AutorunDeps): void;

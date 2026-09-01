import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type PiWorkflows = (pi: ExtensionAPI, workflowsRoot: string) => void;
// choreograph ships ts sources without a type entry point; a variable specifier
// keeps the module out of the type program.
const specifier = "choreograph/src/index.ts";
const piWorkflows = (await import(specifier)).default as PiWorkflows;

/**
 * Binds the workflow engine to the working project's own .agents/workflows, so
 * the cheatcodes-curate workflow is discoverable only in repositories that carry
 * it — never from the shared agent directory.
 */
export default function projectWorkflowsExtension(pi: ExtensionAPI): void {
  piWorkflows(pi, path.join(process.cwd(), ".agents", "workflows"));
}

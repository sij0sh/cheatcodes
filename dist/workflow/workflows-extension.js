import path from "node:path";
// choreograph ships ts sources without a type entry point; a variable specifier
// keeps the module out of the type program.
const specifier = "choreograph/src/index.ts";
const piWorkflows = (await import(specifier)).default;
/**
 * Binds the workflow engine to the working project's own .agents/workflows, so
 * the cheatcodes-curate workflow is discoverable only in repositories that carry
 * it — never from the shared agent directory.
 */
export default function projectWorkflowsExtension(pi) {
    piWorkflows(pi, path.join(process.cwd(), ".agents", "workflows"));
}

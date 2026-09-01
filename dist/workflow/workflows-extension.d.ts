import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * Binds the workflow engine to the working project's own .agents/workflows, so
 * the cheatcodes-curate workflow is discoverable only in repositories that carry
 * it — never from the shared agent directory.
 */
export default function projectWorkflowsExtension(pi: ExtensionAPI): void;

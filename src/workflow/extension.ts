import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createWorkflowTools } from "./tools.js";

/** Pi extension entry: registers the bounded cheatcodes curation tools. */
export default function cheatcodesWorkflow(pi: { registerTool: (tool: ToolDefinition) => void }): void {
  for (const tool of createWorkflowTools()) pi.registerTool(tool);
}

import { readFileSync } from "node:fs";
import { getAgentDir, SessionManager, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { loadGlobalConfig } from "../config.js";
import cheatcodesWorkflow from "./extension.js";

interface TerminalReport {
  status: "completed" | "parked" | "active" | "unknown";
  sessionFile?: string;
  runId?: string;
  positionKey?: string;
  attempt?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Drives the choreograph workflow in a real SDK session. `pi -p` cannot run
 * this workflow: it disposes the session when the triggering turn ends, while
 * the engine still drives steps across turns. The SDK runtime stays alive and
 * rebinds extensions across the engine's session rollovers.
 */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const manifestId = argv[0]?.trim();
  if (!manifestId) {
    console.error("usage: node dist/workflow/headless.js <manifest-id>");
    process.exitCode = 2;
    return;
  }
  const cwd = process.cwd();
  const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }: { cwd: string; sessionManager: SessionManager; sessionStartEvent?: never }) => {
    const services = await createAgentSessionServices({
      cwd,
      // The bounded tools must exist even when project-package discovery is
      // unavailable, so the engine can grant them to each workflow position.
      resourceLoaderOptions: { extensionFactories: [{ name: "cheatcodes-tools", factory: cheatcodesWorkflow }] },
    });
    return {
      ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
      services,
      diagnostics: services.diagnostics,
    };
  };
  const runtime = await createAgentSessionRuntime(createRuntime as never, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.create(cwd),
  });
  const global = await loadGlobalConfig();
  const timeoutMs = (global?.workerTimeoutMinutes ?? 10) * 60_000;
  let pumpedFile = runtime.session.sessionFile;
  const timer = setTimeout(() => {
    console.error(`cheatcodes workflow: worker timed out after ${global?.workerTimeoutMinutes ?? 10} minute(s)`);
    void runtime.session.abort();
  }, timeoutMs);
  try {
    await runtime.session.prompt(`/cheatcodes-curate ${manifestId}`);
  } catch (error) {
    console.error(`cheatcodes workflow: worker failed: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  // The prompt resolves at the engine's first session rollover; the run keeps
  // going in child sessions, so stay alive until a terminal snapshot lands.
  // A rebinding to a non-terminal child stalls it: in headless mode nothing
  // pumps the child's first turn (in the TUI the user is the kick), so the
  // launcher kicks each fresh child once, mirroring the engine's own message.
  const deadline = Date.now() + timeoutMs;
  let report: TerminalReport = { status: "unknown" };
  while (Date.now() < deadline) {
    report = terminalReport(runtime);
    if (report.status === "completed" || report.status === "parked") break;
    if (report.sessionFile && report.sessionFile !== pumpedFile) {
      pumpedFile = report.sessionFile;
      if (runtime.session.pendingMessageCount === 0 && report.runId && report.positionKey) {
        const kick = `Continue workflow \`${report.runId}\` at ${report.positionKey} (attempt ${report.attempt ?? 1}).`;
        await runtime.session.prompt(kick, { streamingBehavior: "followUp" });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  clearTimeout(timer);
  console.log(JSON.stringify(report));
  if (report.status !== "completed") process.exitCode = 1;
}

function terminalReport(runtime: { session: { sessionFile?: string; pendingMessageCount?: number } }): TerminalReport {
  const file = runtime.session.sessionFile;
  if (!file) return { status: "unknown" };
  let status: TerminalReport["status"] = "unknown";
  let runId: string | undefined;
  let positionKey: string | undefined;
  let attempt: number | undefined;
  // Rollover can replace the session file between prompt resolution and this read.
  let content: string;
  try { content = readFileSync(file, "utf8"); } catch { return { status, sessionFile: file }; }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!isRecord(parsed) || parsed.type !== "custom" || parsed.customType !== "choreograph" || !isRecord(parsed.data)) continue;
    if (parsed.data.workflow !== "cheatcodes-curate") continue;
    if (parsed.data.status === "completed") status = "completed";
    else if (parsed.data.status === "parked") status = "parked";
    else if (typeof parsed.data.status === "string") status = "active";
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
if (invoked) main().catch((error) => { console.error(`cheatcodes workflow: ${(error as Error).message}`); process.exitCode = 1; });

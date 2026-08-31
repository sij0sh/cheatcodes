import { readFileSync } from "node:fs";
import { getAgentDir, SessionManager, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { loadGlobalConfig } from "../config.js";

interface TerminalReport {
  status: "completed" | "parked" | "unknown";
  sessionFile?: string;
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
    const services = await createAgentSessionServices({ cwd });
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
  } finally {
    clearTimeout(timer);
  }
  const report = terminalReport(runtime);
  console.log(JSON.stringify(report));
  if (report.status !== "completed") process.exitCode = 1;
}

function terminalReport(runtime: { session: { sessionFile?: string } }): TerminalReport {
  const file = runtime.session.sessionFile;
  if (!file) return { status: "unknown" };
  let status: TerminalReport["status"] = "unknown";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!isRecord(parsed) || parsed.type !== "custom" || parsed.customType !== "choreograph" || !isRecord(parsed.data)) continue;
    if (parsed.data.workflow !== "cheatcodes-curate") continue;
    if (parsed.data.status === "completed") status = "completed";
    else if (typeof parsed.data.status === "string") status = "parked";
  }
  return { status, sessionFile: file };
}

const invoked = process.argv[1] && process.argv[1].endsWith("headless.js");
if (invoked) main().catch((error) => { console.error(`cheatcodes workflow: ${(error as Error).message}`); process.exitCode = 1; });

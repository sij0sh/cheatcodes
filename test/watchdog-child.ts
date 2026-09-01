// Test child for the watchdog test in auto.test.ts. Runs bare runWorker with no
// curator option so the watchdog arms (matching cli.ts and ensure.ts call sites),
// with PiCurator.create patched so the model call hangs or resolves on demand.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PiCurator } from "../src/curate.js";

const mode = process.argv[2] === "resolve" ? "resolve" : "hang";
const root = process.argv[3]!;
const configFile = process.argv[4]!;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: root,
  PI_CODING_AGENT_DIR: path.join(root, "no-pi-agent"),
  CHEATCODES_CONFIG: configFile,
  CHEATCODES_STATE: process.argv[5]!,
};

function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }

interface PacketLike { evidence: Array<{ id: string }> }

async function setup(): Promise<void> {
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, "one.jsonl"), [
    { type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00Z", cwd: root },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "No, that is wrong. We must use the repository adapter instead." }] } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Understood. The repository adapter is required." }] } },
  ].map(line).join(""));
  await writeFile(configFile, JSON.stringify({ version: 2, model: "fake/model", inputs: [sessions], workerTimeoutMinutes: 0.02, projectAliases: {} }));
}

const hungCurator = { async curate(): Promise<never> { return new Promise(() => {}); } };
const resolvingCurator = { async curate(packet: PacketLike) {
  return { entries: [{ action: "create", title: "Use the repository adapter", summary: "Repository access uses the adapter.", body: "The repository adapter is the only persistence boundary.", tags: ["repository"], evidenceRefs: [packet.evidence[0]!.id] }] };
} };
(PiCurator as unknown as { create: () => Promise<unknown> }).create = async () => (mode === "hang" ? hungCurator : resolvingCurator);

const { runWorker } = await import("../src/run.js");
await setup();
await runWorker({ root, env });
if (mode === "resolve") console.log("child-finished");

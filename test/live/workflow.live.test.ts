import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { maintenanceSchedule, maintainProject } from "../../src/maintain.js";
import { buildManifest, commitManifestCursors } from "../../src/workflow/manifests.js";
import { runWorkflowCurator } from "../../src/workflow/runner.js";
import { temporary, writeGlobalConfig } from "../helpers.js";

// Opt-in: drives the real pi CLI with choreograph installed.
const model = process.env.CHEATCODES_LIVE_MODEL;
const root = process.env.CHEATCODES_LIVE_ROOT;

test("workflow curation run against a live project", { timeout: 600_000, skip: !model || !root || process.env.CI === "true" }, async () => {
  const env = { ...process.env };
  const schedule = await maintenanceSchedule(env, root!);
  console.log(`maintenance ${schedule.due ? "due" : "not due"}: ${schedule.reasons.join("; ")}`);
  const build = await buildManifest({ root: root!, env });
  console.log(`manifest: ${build.manifest?.id ?? "none"} (${build.manifest?.packets.length ?? 0} packet(s))`);
  const result = await runWorkflowCurator({ root: root!, env });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  console.log(JSON.stringify({ ...result, applied: result.applied ? { ...result.applied } : undefined }, null, 2));
  assert.ok(result.started, "workflow started");
  assert.equal(result.terminal?.status, "completed");
  if (result.applied) {
    assert.ok(result.applied.transactionId.startsWith("wf-"));
  }
  const replay = await buildManifest({ root: root!, env });
  assert.equal(replay.manifest, undefined, "cursors advance only on success");
});

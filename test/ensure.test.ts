import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { deriveEntryId, entryDigest, renderKnowledgeMarkdown, validateEntry } from "../src/concept.js";
import { deriveProjectKey } from "../src/config.js";
import { writeGlobalConfig, temporary } from "./helpers.js";
import { checkMapFreshness, MAP_FAMILIES } from "../src/map.js";
import { inventoryDigest } from "../src/inventory.js";
import { runEnsure, resolveEnsureTimeoutSeconds, type CurateStage, type EnsureStages, type WorkflowStage } from "../src/ensure.js";
import { loadCurationState, saveCurationState } from "../src/curation-state.js";
import { commitKnowledgeTransaction } from "../src/maintain.js";
const FILE_A = "export const alpha = 1;\n";
const DIGEST_A = createHash("sha256").update(FILE_A).digest("hex");
const SOURCE_A = `repo:src/a.ts#sha256=${DIGEST_A}`;

async function mapFixture(): Promise<{ root: string; env: NodeJS.ProcessEnv; clean: () => Promise<void> }> {
  const root = await temporary();
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), FILE_A);
  const { env } = await writeGlobalConfig({ inputs: [] });
  return { root, env, clean: () => rm(root, { recursive: true, force: true }) };
}

async function seedMapCorpus(root: string, extraSources: string[] = []): Promise<void> {
  const sources = [SOURCE_A, ...extraSources];
  const entries = MAP_FAMILIES.map((tag, index) => validateEntry({
    id: deriveEntryId("ignored", `Map point ${index}`),
    title: `Map point ${index}`,
    summary: "s",
    body: "b",
    tags: [tag],
    sources,
    verificationSources: sources,
  }));
  await mkdir(path.join(root, ".agents"), { recursive: true });
  await writeFile(path.join(root, ".agents", "CHEATCODES.md"), renderKnowledgeMarkdown(entries));
}

function stages(overrides: Partial<EnsureStages>): EnsureStages {
  return {
    curate: async (): Promise<CurateStage> => ({ outcome: "success", changedFiles: 0, entriesWritten: 0 }),
    syncWorkflow: async (): Promise<WorkflowStage> => ({ outcome: "none" }),
    checkMap: async () => ({ state: "absent" }),
    synthesizeMap: async () => ({ ok: true }),
    ...overrides,
  };
}

test("inventoryDigest is stable and detects added, removed, edited, and skipped-dir changes", async () => {
  const root = await temporary();
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), FILE_A);
    await writeFile(path.join(root, "node_modules", "dep.js"), "junk");
    const digest = await inventoryDigest(root);
    assert.equal(digest, await inventoryDigest(root), "digest is stable when nothing changes");
    await writeFile(path.join(root, "node_modules", "other.js"), "junk2");
    assert.equal(digest, await inventoryDigest(root), "dependency directories are skipped");
    await writeFile(path.join(root, "src", "b.ts"), "b");
    const withB = await inventoryDigest(root);
    assert.notEqual(digest, withB, "adding a tracked file changes the digest");
    await writeFile(path.join(root, "src", "b.ts"), "b2");
    assert.notEqual(withB, await inventoryDigest(root), "editing a tracked file changes the digest");
    await rm(path.join(root, "src", "b.ts"));
    assert.equal(digest, await inventoryDigest(root), "removing the file restores the digest");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("checkMapFreshness reports absent, seeds on first check, and detects source and inventory staleness", async () => {
  const { root, env, clean } = await mapFixture();
  try {
    assert.deepEqual(await checkMapFreshness(root, env), { state: "absent" });
    await seedMapCorpus(root);
    assert.deepEqual(await checkMapFreshness(root, env), { state: "fresh", seeded: true });
    assert.deepEqual(await checkMapFreshness(root, env), { state: "fresh" });
    await writeFile(path.join(root, "src", "a.ts"), "edited");
    assert.deepEqual(await checkMapFreshness(root, env), { state: "stale", reason: "sources changed" });
    await writeFile(path.join(root, "src", "a.ts"), FILE_A);
    assert.deepEqual(await checkMapFreshness(root, env), { state: "fresh" });
    await writeFile(path.join(root, "src", "new.ts"), "new");
    assert.deepEqual(await checkMapFreshness(root, env), { state: "stale", reason: "inventory changed" });
    await rm(path.join(root, "src", "new.ts"));
    assert.deepEqual(await checkMapFreshness(root, env), { state: "fresh" });
  } finally { await clean(); }
});

test("a committed map stores the inventory digest and clears staleness", async () => {
  const { root, env, clean } = await mapFixture();
  try {
    await seedMapCorpus(root);
    const projectKey = await deriveProjectKey(root);
    const { loadCorpus } = await import("../src/workflow/tools.js");
    const { entries, revision } = await loadCorpus(root, env);
    const target = entries.find((entry) => entry.title === "Map point 0")!;
    // The same post-commit cursor write runMap performs.
    await commitKnowledgeTransaction(env, root, {
      transactionId: "tx-map-test",
      projectKey,
      baseRevision: revision,
      packetIds: [],
      promptVersion: "test",
      modelId: "test",
      operations: [{ op: "update", target: { id: target.id, expectedDigest: entryDigest(target) }, entry: { title: target.title, summary: "s2", body: "b2", sources: [SOURCE_A, SOURCE_A], verificationSources: [SOURCE_A, SOURCE_A] } }],
    });
    const state = await loadCurationState(env, projectKey);
    await saveCurationState(env, { ...state, mapCursor: { inventoryDigest: await inventoryDigest(root), checkedAt: new Date().toISOString() } });
    assert.deepEqual(await checkMapFreshness(root, env), { state: "fresh" });
  } finally { await clean(); }
});

test("runEnsure reports locked, up-to-date, refreshed, timeout, and error from the curation stage", async () => {
  const root = await temporary();
  const env = (await writeGlobalConfig({ inputs: [] })).env;
  try {
    const locked = await runEnsure({ root, env, stages: stages({ curate: async () => ({ outcome: "coalesced" }) }) });
    assert.equal(locked.status, "locked");

    const fresh = await runEnsure({ root, env, stages: stages({}) });
    assert.equal(fresh.status, "up-to-date");
    assert.equal(fresh.map, "absent");

    const refreshed = await runEnsure({
      root,
      env,
      stages: stages({ curate: async () => ({ outcome: "success", changedFiles: 2, entriesWritten: 1 }) }),
    });
    assert.equal(refreshed.status, "refreshed");
    assert.deepEqual(refreshed.curated, { changedFiles: 2, entriesWritten: 1 });

    const workflowRefreshed = await runEnsure({
      root,
      env,
      stages: stages({ syncWorkflow: async () => ({ outcome: "completed" }) }),
    });
    assert.equal(workflowRefreshed.status, "refreshed");
    assert.equal(workflowRefreshed.workflow, "completed");

    const timedOut = await runEnsure({ root, env, stages: stages({ curate: async () => ({ outcome: "timeout" }) }) });
    assert.equal(timedOut.status, "timeout");
    assert.equal(timedOut.workflow, "skipped");

    const failed = await runEnsure({ root, env, stages: stages({ curate: async () => ({ outcome: "failed", reason: "boom" }) }) });
    assert.equal(failed.status, "error");
    assert.equal(failed.warning, "boom");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runEnsure reports map staleness and synthesizes only when asked", async () => {
  const root = await temporary();
  const env = (await writeGlobalConfig({ inputs: [] })).env;
  try {
    let synthesized = 0;
    const base: Partial<EnsureStages> = {
      checkMap: async () => ({ state: "stale", reason: "inventory changed" }),
      synthesizeMap: async () => {
        synthesized += 1;
        return { ok: true };
      },
    };
    const reported = await runEnsure({ root, env, stages: stages(base) });
    assert.equal(reported.map, "stale (inventory changed)");
    assert.equal(reported.status, "up-to-date");
    assert.equal(synthesized, 0);

    const synthesizedResult = await runEnsure({ root, env, synthesizeMap: true, stages: stages(base) });
    assert.equal(synthesizedResult.map, "synthesized");
    assert.equal(synthesizedResult.status, "refreshed");
    assert.equal(synthesized, 1);

    const failed = await runEnsure({
      root,
      env,
      synthesizeMap: true,
      stages: stages({ ...base, synthesizeMap: async () => ({ ok: false, warning: "no model" }) }),
    });
    assert.equal(failed.map, "failed");
    assert.equal(failed.status, "error");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resolveEnsureTimeoutSeconds prefers the flag, then the environment, then the default", () => {
  const env = { CHEATCODES_ENSURE_TIMEOUT: "45" } as NodeJS.ProcessEnv;
  assert.equal(resolveEnsureTimeoutSeconds(env, 10), 10);
  assert.equal(resolveEnsureTimeoutSeconds(env), 45);
  assert.equal(resolveEnsureTimeoutSeconds({}, 0), 120);
  assert.equal(resolveEnsureTimeoutSeconds({ CHEATCODES_ENSURE_TIMEOUT: "bogus" } as NodeJS.ProcessEnv), 120);
});

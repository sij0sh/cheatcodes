import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { deriveProjectKey } from "../src/config.js";
import { emptyCurationState, loadCurationState, saveCurationState, updateCurationState, type CurationState } from "../src/curation-state.js";
import { acquireProjectLock } from "../src/state.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

async function project(): Promise<{ root: string; env: NodeJS.ProcessEnv; key: string; clean: () => Promise<void> }> {
  const root = await temporary();
  const { env } = await writeGlobalConfig({ inputs: [] });
  const key = await deriveProjectKey(root);
  return { root, env, key, clean: () => rm(root, { recursive: true, force: true }) };
}

function seededState(key: string): CurationState {
  return {
    ...emptyCurationState(key, "rev-1"),
    packetOutcomes: { "pkt-1": { packetId: "pkt-1", at: "2026-01-01T00:00:00Z", status: "applied" } },
    tombstones: [{ id: "e1", title: "Old entry", op: "delete", reason: "stale", digest: "d1", transactionId: "tx-1", removedAt: "2026-01-01T00:00:00Z" }],
    transactions: [{ transactionId: "tx-1", at: "2026-01-01T00:00:00Z", baseRevision: "rev-0", resultRevision: "rev-1", applied: ["e1"], entryCountBefore: 1, entryCountAfter: 0 }],
  };
}

test("updateCurationState reloads under the lock so a stale caller copy cannot revert a commit", async () => {
  const { root, env, key, clean } = await project();
  try {
    await saveCurationState(env, seededState(key));
    const stale = await loadCurationState(env, key);
    // A locked commit lands between the stale read and the cursor write.
    await saveCurationState(env, {
      ...stale,
      transactions: [...stale.transactions, { transactionId: "tx-2", at: "2026-01-01T00:01:00Z", baseRevision: "rev-1", resultRevision: "rev-2", applied: ["e2"], entryCountBefore: 0, entryCountAfter: 1 }],
    });
    await updateCurationState(env, key, (current) => ({ ...current, mapCursor: { inventoryDigest: "digest", checkedAt: "2026-01-01T00:02:00Z" } }));
    const final = await loadCurationState(env, key);
    assert.ok(final.transactions.some((receipt) => receipt.transactionId === "tx-2"), "the interleaved commit survives");
    assert.equal(final.tombstones.length, 1, "the tombstone survives");
    assert.ok(final.packetOutcomes["pkt-1"], "the packet outcome survives");
    assert.deepEqual(final.mapCursor, { inventoryDigest: "digest", checkedAt: "2026-01-01T00:02:00Z" }, "the cursor write lands");
  } finally { await clean(); }
});

test("updateCurationState skips the write when the bounded lock wait expires", async () => {
  const { root, env, key, clean } = await project();
  try {
    await saveCurationState(env, seededState(key));
    const lock = await acquireProjectLock(env, key);
    const updated = await updateCurationState(env, key, (current) => ({ ...current, revision: "rev-9" }), { waitMs: 50 });
    assert.equal(updated, undefined, "contention with a live owner skips the write");
    const onDisk = await loadCurationState(env, key);
    assert.equal(onDisk.revision, "rev-1", "state is untouched");
    await lock.release();
    const after = await updateCurationState(env, key, (current) => ({ ...current, revision: "rev-9" }), { waitMs: 50 });
    assert.equal(after?.revision, "rev-9", "the write proceeds once the lock frees");
  } finally { await clean(); }
});

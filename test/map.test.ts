import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deriveEntryId, entryDigest, validateEntry, type KnowledgeEntry } from "../src/concept.js";
import {
  MAP_TITLES,
  REPO_SOURCE_PATTERN,
  describeMapOperations,
  stampRepoVerification,
  validateMapOperations,
  verifyRepoSources,
  type MapContext,
} from "../src/map.js";
import { inspectProjectFactTool, inspectProjectTreeTool, TREE_LIMITS } from "../src/workflow/tools.js";
import { temporary } from "./helpers.js";

const PROJECT = "test-project";
const SOURCE_A = "export const alpha = 1;\n";
const SOURCE_B = "export const beta = 2;\n";
const DIGEST_A = createHash("sha256").update(SOURCE_A).digest("hex");
const DIGEST_B = createHash("sha256").update(SOURCE_B).digest("hex");
const SOURCE_REF_A = `repo:src/a.ts#sha256=${DIGEST_A}`;
const SOURCE_REF_B = `repo:src/b.ts#sha256=${DIGEST_B}`;

function mapEntry(title: string, sources: string[] = [SOURCE_REF_A, SOURCE_REF_B]): KnowledgeEntry {
  return validateEntry({ id: deriveEntryId(PROJECT, title), title, summary: "s", body: "b", sources });
}

function createContext(entries: KnowledgeEntry[] = []): MapContext {
  return { entries, projectKey: PROJECT, existing: entries.map((entry) => ({ id: entry.id, title: entry.title, summary: entry.summary, digest: entryDigest(entry) })) };
}

function createOp(title: string, sources: string[] = [SOURCE_REF_A, SOURCE_REF_B]) {
  return { op: "create", entry: { title, summary: "s", body: "b", sources } };
}

function updateOp(title: string, digest: string, sources: string[] = [SOURCE_REF_A, SOURCE_REF_B]) {
  return { op: "update", target: { id: deriveEntryId(PROJECT, title), expectedDigest: digest }, entry: { title, summary: "s", body: "b", sources } };
}

async function mapFixture(options: { nested?: boolean } = {}) {
  const root = await temporary();
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), SOURCE_A);
  await writeFile(path.join(root, "src", "b.ts"), SOURCE_B);
  await writeFile(path.join(root, "package.json"), "{}\n");
  await writeFile(path.join(root, "node_modules", "dep.js"), "junk");
  await writeFile(path.join(root, ".git", "HEAD"), "ref: main");
  if (options.nested) {
    await mkdir(path.join(root, "a", "b", "c", "d", "e"), { recursive: true });
    await writeFile(path.join(root, "a", "b", "c", "d", "e", "deep.ts"), "deep");
  }
  return { root, clean: () => rm(root, { recursive: true, force: true }) };
}

function parseResult(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(result.content[0]!.text);
}

test("REPO_SOURCE_PATTERN accepts only well-formed repo sources with 64-hex digests", () => {
  assert.deepEqual(REPO_SOURCE_PATTERN.exec(SOURCE_REF_A)?.slice(1), ["src/a.ts", DIGEST_A]);
  for (const bad of [
    "repo:src/a.ts",
    "repo:src/a.ts#sha256=abc123",
    "repo:src/a.ts#sha256=" + "Z".repeat(64),
    "repo:src/a#b.ts#sha256=" + "a".repeat(64),
    "https://example.com#a",
    "file:src/a.ts",
    "",
  ]) {
    assert.equal(REPO_SOURCE_PATTERN.test(bad), false, `expected reject: ${bad}`);
  }
});

test("validateMapOperations accepts a valid set of create and update operations", () => {
  const existing = mapEntry("System map");
  const ops = validateMapOperations(
    { operations: [createOp("Project brief"), updateOp("System map", entryDigest(existing))] },
    createContext([existing]),
  );
  assert.equal(ops.length, 2);
});

test("validateMapOperations accepts zero operations", () => {
  assert.deepEqual(validateMapOperations({ operations: [] }, createContext()), []);
});

test("validateMapOperations rejects more than three operations", () => {
  assert.throws(
    () => validateMapOperations({ operations: [createOp("Project brief"), createOp("System map"), createOp("Capability map"), createOp("Project brief")] }, createContext()),
    /operations/,
  );
});

test("validateMapOperations rejects unknown and duplicate titles", () => {
  assert.throws(() => validateMapOperations({ operations: [createOp("Architecture")] }, createContext()), /title must be one of/);
  assert.throws(
    () => validateMapOperations({ operations: [createOp("Project brief"), createOp("Project brief")] }, createContext()),
    /duplicate title/,
  );
});

test("validateMapOperations rejects non create/update operations", () => {
  const existing = mapEntry("System map");
  const op = { op: "delete", target: { id: existing.id, expectedDigest: entryDigest(existing) }, reason: "r", verification: { verifiedAt: "2026-01-01T00:00:00Z", sources: [SOURCE_REF_A] } };
  assert.throws(() => validateMapOperations({ operations: [op] }, createContext([existing])), /only create and update/);
});

test("validateMapOperations enforces the provenance rules", () => {
  const single = [createOp("Project brief", [SOURCE_REF_A])];
  assert.throws(() => validateMapOperations({ operations: single }, createContext()), /at least two repo: sources/);
  const malformed = [createOp("Project brief", [SOURCE_REF_A, "https://example.com"])];
  assert.throws(() => validateMapOperations({ operations: malformed }, createContext()), /malformed repo source/);
  const duplicate = [createOp("Project brief", [SOURCE_REF_A, SOURCE_REF_A])];
  assert.throws(() => validateMapOperations({ operations: duplicate }, createContext()), /sources must be distinct/);
  const tagged = [{ op: "create", entry: { title: "Project brief", summary: "s", body: "b", sources: [SOURCE_REF_A, SOURCE_REF_B], tags: ["x"] } }];
  assert.throws(() => validateMapOperations({ operations: tagged }, createContext()), /tags must be unset/);
  const kinded = [{ op: "create", entry: { title: "Project brief", summary: "s", body: "b", sources: [SOURCE_REF_A, SOURCE_REF_B], kind: "decision" } }];
  assert.throws(() => validateMapOperations({ operations: kinded }, createContext()), /kind must be unset/);
});

test("validateMapOperations forces update when a derived entry id already exists", () => {
  const existing = mapEntry("Project brief");
  assert.throws(
    () => validateMapOperations({ operations: [createOp("Project brief")] }, createContext([existing])),
    /already exists; use update instead/,
  );
});

test("validateMapOperations rejects stale update digests and mismatched update targets", () => {
  const existing = mapEntry("System map");
  assert.throws(
    () => validateMapOperations({ operations: [updateOp("System map", "deadbeef00")] }, createContext([existing])),
    /digest mismatch/,
  );
  const mismatched = { op: "update", target: { id: deriveEntryId(PROJECT, "Project brief"), expectedDigest: entryDigest(existing) }, entry: { title: "System map", summary: "s", body: "b", sources: [SOURCE_REF_A, SOURCE_REF_B] } };
  assert.throws(
    () => validateMapOperations({ operations: [mismatched] }, createContext([existing])),
    /does not match the id derived from the title/,
  );
});

test("verifyRepoSources passes matching files and reports stale, missing, malformed, and escaping sources", async () => {
  const root = await temporary();
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), SOURCE_A);
    await writeFile(path.join(root, "src", "b.ts"), SOURCE_B);
    await writeFile(path.join(root, "..", "outside.txt"), "x");
    const stale = `repo:src/a.ts#sha256=${"0".repeat(64)}`;
    const missing = `repo:src/gone.ts#sha256=${DIGEST_A}`;
    const escaping = `repo:../outside.txt#sha256=${DIGEST_A}`;
    const ops = [
      createOp("Project brief", [SOURCE_REF_A, SOURCE_REF_B]),
      createOp("System map", [SOURCE_REF_A, stale, missing, escaping, "not-a-repo-source"]),
    ];
    const issues = await verifyRepoSources(root, ops);
    assert.deepEqual(issues.map((issue) => issue.reason).sort(), [
      "digest mismatch",
      "file is missing or unreadable",
      "malformed repo source",
      "path escapes the project root",
    ]);
    assert.deepEqual(await verifyRepoSources(root, [createOp("Project brief")]), []);
  } finally {
    await rm(path.join(root, "..", "outside.txt"), { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("stampRepoVerification sets verifiedAt and verificationSources on create and update operations only", () => {
  const now = new Date("2026-02-03T04:05:06Z");
  const seeded = mapEntry("System map");
  const del = { op: "delete", target: { id: seeded.id, expectedDigest: entryDigest(seeded) }, reason: "r", verification: { verifiedAt: "2026-01-01T00:00:00Z", sources: [SOURCE_REF_A] } };
  const stamped = stampRepoVerification([createOp("Project brief"), updateOp("System map", entryDigest(seeded)), del], now);
  for (const op of stamped.slice(0, 2)) {
    assert.ok(op.op === "create" || op.op === "update");
    assert.equal(op.entry.verifiedAt, "2026-02-03T04:05:06.000Z");
    assert.deepEqual(op.entry.verificationSources, [SOURCE_REF_A, SOURCE_REF_B]);
  }
  assert.equal(stamped[2], del);
});

test("describeMapOperations renders create and update plans", () => {
  const seeded = mapEntry("System map");
  const lines = describeMapOperations([createOp("Project brief"), updateOp("System map", entryDigest(seeded))], PROJECT);
  assert.match(lines[0]!, /^create "Project brief" \(2 source\(s\)\) -> cc-/);
  assert.match(lines[1]!, /^update cc-.* "System map" \(2 source\(s\)\)$/);
});

test("inspect_project_fact reports the sha256 of the full file content", async () => {
  const { root, clean } = await mapFixture();
  try {
    const tool = inspectProjectFactTool({ CHEATCODES_PROJECT_ROOT: root } as NodeJS.ProcessEnv);
    const result = parseResult(await tool.execute("id", { path: "src/a.ts" } as never, undefined, undefined, undefined as never));
    assert.equal(result.sha256, DIGEST_A);
    assert.equal(result.totalLines, 2);
  } finally { await clean(); }
});

test("inspect_project_tree lists sorted paths with sizes and skips dependency and metadata directories", async () => {
  const { root, clean } = await mapFixture({ nested: true });
  try {
    const tool = inspectProjectTreeTool({ CHEATCODES_PROJECT_ROOT: root } as NodeJS.ProcessEnv);
    const result = parseResult(await tool.execute("id", {} as never, undefined, undefined, undefined as never));
    assert.equal(result.truncated, false);
    assert.deepEqual(result.entries.map((entry: { path: string }) => entry.path), [
      "a/", "a/b/", "a/b/c/", "a/b/c/d/", "a/b/c/d/e/",
      "package.json", "src/", "src/a.ts", "src/b.ts",
    ]);
    assert.deepEqual(result.entries.filter((entry: { bytes?: number }) => entry.bytes !== undefined).map((entry: { bytes: number }) => entry.bytes), [3, SOURCE_A.length, SOURCE_B.length]);
    assert.equal(result.totalFiles, 3);
  } finally { await clean(); }
});

test("inspect_project_tree marks truncation beyond the depth and entry caps", async () => {
  const root = await temporary();
  try {
    await mkdir(path.join(root, "many"), { recursive: true });
    for (let index = 0; index < TREE_LIMITS.entries + 5; index++) {
      await writeFile(path.join(root, "many", `f${String(index).padStart(4, "0")}.txt`), "x");
    }
    const tool = inspectProjectTreeTool({ CHEATCODES_PROJECT_ROOT: root } as NodeJS.ProcessEnv);
    const result = parseResult(await tool.execute("id", {} as never, undefined, undefined, undefined as never));
    assert.equal(result.truncated, true);
    assert.ok(result.entries.length <= TREE_LIMITS.entries);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("map titles are the three fixed entry titles", () => {
  assert.deepEqual([...MAP_TITLES], ["Project brief", "System map", "Capability map"]);
});

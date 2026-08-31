import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { Curator } from "../src/curate.js";
import type { HarvestPacket } from "../src/harvest.js";
import { curationMetricsPath, type CurationMetrics } from "../src/metrics.js";
import {
  GATE_IDS,
  PROPOSED_TEXT_LIMITS,
  QUALIFIER_PROMPT,
  REJECTION_REASONS,
  qualificationToCurated,
  validateQualification,
  type GateId,
  type GateResult,
  type QualifiedCandidate,
  type QualificationOutcome,
} from "../src/qualify.js";
import { runProject } from "../src/run.js";
import { loadGlobalState } from "../src/state.js";
import { temporary, writeGlobalConfig } from "./helpers.js";

function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }
const session = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00Z", cwd: "/repo", ...extra });
const user = (id: string, parentId: string | null, text: string, timestamp: string): Record<string, unknown> =>
  ({ type: "message", id, parentId, timestamp, message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (id: string, parentId: string, text: string, timestamp: string): Record<string, unknown> =>
  ({ type: "message", id, parentId, timestamp, message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] } });

function correctionSession(): string {
  return [
    line(session("session-1")),
    line(user("u1", null, "No, that is wrong. Use the repository adapter instead.", "2026-01-01T00:00:01Z")),
    line(assistant("a1", "u1", "Understood. The repository adapter is required.", "2026-01-01T00:00:02Z")),
  ].join("").replaceAll("/repo", "__ROOT__");
}

async function sessionProject(): Promise<{ root: string; env: NodeJS.ProcessEnv; file: string; dispose: () => Promise<void> }> {
  const root = await temporary();
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  const file = path.join(sessions, "one.jsonl");
  await writeFile(file, correctionSession().replaceAll("__ROOT__", root));
  const { env } = await writeGlobalConfig({ inputs: [sessions] });
  return { root, env, file, dispose: () => rm(root, { recursive: true, force: true }) };
}

function makePacket(overrides: Partial<HarvestPacket> = {}): HarvestPacket {
  return {
    id: "pkt-1",
    projectKey: "proj",
    sessionId: "s1",
    episodeId: "e1",
    recordIds: ["u1", "a1"],
    signals: [],
    closure: "assistant-settled",
    signalReasons: [],
    omittedEvidenceCount: 0,
    packetFitReason: "fit",
    userIntent: "intent",
    finalAssistantSummary: "summary",
    evidence: [{ id: "ev-1", kind: "message", excerpt: "excerpt", recordIds: ["u1"] }],
    shortlist: [],
    ...overrides,
  };
}

const allPass = Object.fromEntries(GATE_IDS.map((gate) => [gate, "pass"])) as Record<GateId, GateResult>;

function acceptCandidate(overrides: Partial<QualifiedCandidate> = {}): QualifiedCandidate {
  return {
    candidateId: "pkt-1",
    verdict: "accept",
    gateResults: allPass,
    claims: [{ text: "claim", evidenceRefs: ["ev-1"] }],
    rejectionReasons: [],
    unresolvedQuestions: [],
    proposedEntry: { title: "t", summary: "s", body: "b", tags: [] },
    ...overrides,
  };
}

test("qualifier prompt names the terminating tool and the review path", () => {
  assert.equal(QUALIFIER_PROMPT.includes("submit_qualification"), true);
  assert.equal(QUALIFIER_PROMPT.includes("needs-review"), true);
  assert.equal(QUALIFIER_PROMPT.includes("final action"), true);
});

test("qualification schema and host invariants", () => {
  const packet = makePacket();
  assert.doesNotThrow(() => validateQualification({ entries: [acceptCandidate()] }, packet));
  assert.throws(() => validateQualification({ entries: [acceptCandidate({ extra: 1 } as unknown as QualifiedCandidate)] }, packet));
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ gateResults: { ...allPass, durable: "fail" } })] }, packet),
    /failed gates: durable/,
  );
  assert.throws(() => validateQualification({ entries: [acceptCandidate({ claims: [] })] }, packet), /requires claims/);
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ claims: [{ text: "x", evidenceRefs: [] }] })] }, packet),
    /claim 0 requires evidence/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ proposedEntry: undefined })] }, packet),
    /requires proposedEntry/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ rejectionReasons: ["generic-advice"] })] }, packet),
    /must not carry rejection reasons/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ verdict: "reject", rejectionReasons: [] })] }, packet),
    /requires a stable rejection reason/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ verdict: "needs-review", unresolvedQuestions: [] })] }, packet),
    /requires unresolved questions/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ verdict: "reject", proposedEntry: { title: "t", summary: "s", body: "b", tags: [] } })] }, packet),
    /allowed only for accept/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ claims: [{ text: "x", evidenceRefs: ["ev-x"] }] })] }, packet),
    /Unknown evidence reference: ev-x/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ candidateId: "pkt-other" })] }, packet),
    /candidateId must be the packet id pkt-1/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ proposedEntry: { title: "t", summary: "s", body: "has <!-- cheatcodes-entry x --> inside", tags: [] } })] }, packet),
    /reserved text/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate({ proposedEntry: { title: "t", summary: "s", body: "b".repeat(PROPOSED_TEXT_LIMITS.body + 1), tags: [] } })] }, packet),
    /body exceeds/,
  );
  assert.throws(
    () => validateQualification({ entries: [acceptCandidate(), acceptCandidate()] }, packet),
    /at most one qualification per packet/,
  );
});

test("compatibility adapter maps accepted candidates to curated actions", () => {
  const candidate = acceptCandidate({ claims: [{ text: "a", evidenceRefs: ["ev-1"] }, { text: "b", evidenceRefs: ["ev-1", "ev-2"] }] });
  const packet = makePacket({ evidence: [{ id: "ev-1", kind: "message", excerpt: "1", recordIds: ["u1"] }, { id: "ev-2", kind: "tool", excerpt: "2", recordIds: ["t1"] }] });
  const created = qualificationToCurated(candidate, packet);
  assert.equal(created.action, "create");
  assert.equal(created.targetEntryId, undefined);
  assert.deepEqual(created.evidenceRefs, ["ev-1", "ev-2"]);
  const updated = qualificationToCurated(candidate, makePacket({ updateCandidate: { id: "cc-1", title: "T", summary: "S", score: 2, body: "B" } }));
  assert.equal(updated.action, "update");
  assert.equal(updated.targetEntryId, "cc-1");
  assert.throws(() => qualificationToCurated(acceptCandidate({ verdict: "reject" }), packet), /only accepted candidates/);
});

interface GoldenFixture {
  name: string;
  packet: { id: string; userIntent: string; finalAssistantSummary: string; signals: HarvestPacket["signals"]; closure: HarvestPacket["closure"]; evidence: HarvestPacket["evidence"]; shortlist?: HarvestPacket["shortlist"]; updateCandidate?: HarvestPacket["updateCandidate"] };
  submission: { entries: QualifiedCandidate[] };
  expect: { valid: boolean; verdict: string; kind?: string; notes: string };
}

test("golden dataset validates and covers the semantic space", async () => {
  const dir = new URL("./fixtures/curation-golden/", import.meta.url);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  assert.equal(files.length >= 20, true);
  const verdictCounts = { accept: 0, reject: 0, "needs-review": 0 };
  const reasons = new Set<string>();
  const seenIds = new Set<string>();
  for (const file of files) {
    const fixture = JSON.parse(await readFile(new URL(`./fixtures/curation-golden/${file}`, import.meta.url), "utf8")) as GoldenFixture;
    assert.equal(fixture.expect.notes.length > 0, true, `${fixture.name}: reviewer notes required`);
    assert.equal(seenIds.has(fixture.packet.id), false, `${fixture.name}: packet ids must be unique`);
    seenIds.add(fixture.packet.id);
    const packet = makePacket({
      id: fixture.packet.id,
      userIntent: fixture.packet.userIntent,
      finalAssistantSummary: fixture.packet.finalAssistantSummary,
      signals: fixture.packet.signals,
      closure: fixture.packet.closure,
      evidence: fixture.packet.evidence,
      shortlist: fixture.packet.shortlist ?? [],
      ...(fixture.packet.updateCandidate ? { updateCandidate: fixture.packet.updateCandidate } : {}),
    });
    const parsed = validateQualification(fixture.submission, packet);
    const candidate = parsed.entries[0]!;
    assert.equal(candidate.verdict, fixture.expect.verdict, `${fixture.name}: verdict`);
    verdictCounts[candidate.verdict] += 1;
    if (fixture.expect.kind) assert.equal(candidate.kind, fixture.expect.kind, `${fixture.name}: kind`);
    for (const reason of candidate.rejectionReasons) reasons.add(reason);
    if (candidate.verdict === "accept") {
      assert.equal(candidate.claims.length > 0, true, `${fixture.name}: accepted needs claims`);
      assert.equal(candidate.proposedEntry !== undefined, true, `${fixture.name}: accepted needs proposedEntry`);
      const curated = qualificationToCurated(candidate, packet);
      assert.equal(curated.action, packet.updateCandidate ? "update" : "create", `${fixture.name}: adapter action`);
    }
    if (candidate.verdict === "reject") assert.equal(candidate.rejectionReasons.length > 0, true, `${fixture.name}: rejects need reasons`);
    if (candidate.verdict === "needs-review") assert.equal(candidate.unresolvedQuestions.length > 0, true, `${fixture.name}: reviews need questions`);
  }
  assert.equal(verdictCounts.accept >= 6, true);
  assert.equal(verdictCounts.reject >= 8, true);
  assert.equal(verdictCounts["needs-review"] >= 4, true);
  for (const reason of REJECTION_REASONS) assert.equal(reasons.has(reason), true, `golden set must cover reason ${reason}`);
});

async function readMetrics(env: NodeJS.ProcessEnv): Promise<CurationMetrics[]> {
  const file = curationMetricsPath(env);
  const text = await readFile(file, "utf8");
  return text.trim().split("\n").map((lineText) => JSON.parse(lineText) as CurationMetrics);
}

const typedQualifier = (outcomeFor: (packet: HarvestPacket) => QualificationOutcome) => ({ async qualify(packet: HarvestPacket) { return outcomeFor(packet); } });

test("typed mode writes only accepted candidates and parks on schema failure", async () => {
  const { root, env, dispose } = await sessionProject();
  try {
    const typedEnv = { ...env, CHEATCODES_CURATOR_MODE: "typed" };
    const knowledgeFile = path.join(root, ".agents", "CHEATCODES.md");
    const acceptOutcome = (packet: HarvestPacket): QualificationOutcome => ({
      response: { entries: [acceptCandidate({
        candidateId: packet.id,
        claims: [{ text: "The repository adapter is required.", evidenceRefs: [packet.evidence[0]!.id] }],
        proposedEntry: { title: "Use the repository adapter", summary: "Persistence goes through the repository adapter.", body: "All persistence must use the repository adapter boundary.", tags: ["architecture"] },
      })] },
      schemaInvalid: false, schemaRetries: 0, latencyMs: 3,
    });
    const acceptRun = await runProject({ root, env: typedEnv, qualifier: typedQualifier(acceptOutcome) });
    assert.equal(acceptRun.mode, "typed");
    assert.equal(acceptRun.packets, 1);
    assert.equal(acceptRun.entriesWritten, 1);
    assert.equal((await readFile(knowledgeFile, "utf8")).includes("Use the repository adapter"), true);
    const metrics = await readMetrics(typedEnv);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0]!.verdict, "accept");
    assert.equal(metrics[0]!.wrote, true);
    assert.equal(metrics[0]!.mode, "typed");
  } finally { await dispose(); }
});

test("typed mode rejects advance the cursor without writing", async () => {
  const { root, env, dispose } = await sessionProject();
  try {
    const typedEnv = { ...env, CHEATCODES_CURATOR_MODE: "typed" };
    const rejectOutcome = (packet: HarvestPacket): QualificationOutcome => ({
      response: { entries: [{ candidateId: packet.id, verdict: "reject", gateResults: { ...allPass, durable: "fail" }, claims: [], rejectionReasons: ["transient-work-state"], unresolvedQuestions: [] }] },
      schemaInvalid: false, schemaRetries: 0, latencyMs: 2,
    });
    const first = await runProject({ root, env: typedEnv, qualifier: typedQualifier(rejectOutcome) });
    assert.equal(first.entriesWritten, 0);
    assert.equal(first.unresolvedFiles, 0);
    const second = await runProject({ root, env: typedEnv, qualifier: typedQualifier(rejectOutcome) });
    assert.equal(second.packets, 0, "a rejected packet must advance the cursor so it is not revisited");
    const metrics = await readMetrics(typedEnv);
    assert.equal(metrics.length, 1);
    assert.deepEqual(metrics[0]!.rejectionReasons, ["transient-work-state"]);
    assert.equal(metrics[0]!.wrote, false);
    assert.equal(metrics[0]!.gateFailures.includes("durable"), true);
  } finally { await dispose(); }
});

test("typed mode parks the file when qualification never validates", async () => {
  const { root, env, dispose } = await sessionProject();
  try {
    const typedEnv = { ...env, CHEATCODES_CURATOR_MODE: "typed" };
    const failing: QualificationOutcome = { schemaInvalid: true, warning: "synthetic schema failure", schemaRetries: 2, latencyMs: 4 };
    const run = await runProject({ root, env: typedEnv, qualifier: typedQualifier(() => failing) });
    assert.equal(run.unresolvedFiles, 1);
    const state = await loadGlobalState(typedEnv);
    assert.deepEqual(Object.keys(state.projects[run.projectKey]?.files ?? {}), []);
    const metrics = await readMetrics(typedEnv);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0]!.verdict, undefined);
    assert.equal(metrics[0]!.wrote, false);
    assert.equal(metrics[0]!.schemaRetries, 2);
  } finally { await dispose(); }
});

test("shadow mode records typed and legacy agreement without writing", async () => {
  const { root, env, dispose } = await sessionProject();
  try {
    const shadowEnv = { ...env, CHEATCODES_CURATOR_MODE: "shadow" };
    const acceptOutcome = (packet: HarvestPacket): QualificationOutcome => ({
      response: { entries: [acceptCandidate({
        candidateId: packet.id,
        claims: [{ text: "The repository adapter is required.", evidenceRefs: [packet.evidence[0]!.id] }],
        proposedEntry: { title: "Use the repository adapter", summary: "Persistence goes through the repository adapter.", body: "All persistence must use the repository adapter boundary.", tags: ["architecture"] },
      })] },
      schemaInvalid: false, schemaRetries: 0, latencyMs: 3,
    });
    const legacyEmpty: Curator = { async curate() { return { entries: [] }; } };
    const disagree = await runProject({ root, env: shadowEnv, qualifier: typedQualifier(acceptOutcome), curator: legacyEmpty });
    assert.equal(disagree.mode, "shadow");
    assert.equal(disagree.entriesWritten, 0);
    assert.equal(disagree.curatorCalls, 2, "shadow runs the typed qualifier and the legacy curator once each");
    const legacyWrites: Curator = {
      async curate(packet) {
        return { entries: [{ action: "create", title: "t", summary: "s", body: "b", tags: [], evidenceRefs: [packet.evidence[0]!.id] }] };
      },
    };
    await writeFile(path.join(root, "sessions", "two.jsonl"), correctionSession().replaceAll("session-1", "session-2").replaceAll("__ROOT__", root));
    const agree = await runProject({ root, env: shadowEnv, qualifier: typedQualifier(acceptOutcome), curator: legacyWrites });
    assert.equal(agree.entriesWritten, 0, "shadow must never write");
    const metrics = await readMetrics(shadowEnv);
    assert.equal(metrics.length, 2);
    assert.equal(metrics[0]!.agreement, "disagree");
    assert.equal(metrics[0]!.legacyWouldWrite, false);
    assert.equal(metrics[1]!.agreement, "agree");
    assert.equal(metrics[1]!.legacyWouldWrite, true);
    for (const record of metrics) assert.equal(record.wrote, false);
  } finally { await dispose(); }
});

test("legacy mode stays the default and records no metrics", async () => {
  const { root, env, dispose } = await sessionProject();
  try {
    const legacy: Curator = { async curate() { return { entries: [] }; } };
    const run = await runProject({ root, env, curator: legacy });
    assert.equal(run.mode, "legacy");
    assert.equal(existsSync(curationMetricsPath(env)), false);
    const bogusEnv = { ...env, CHEATCODES_CURATOR_MODE: "bogus" };
    const warnings: string[] = [];
    const bogus = await runProject({ root, env: bogusEnv, curator: legacy, onWarning: (message) => warnings.push(message) });
    assert.equal(bogus.mode, "legacy");
    assert.equal(warnings.some((message) => /unknown CHEATCODES_CURATOR_MODE/.test(message)), true);
  } finally { await dispose(); }
});

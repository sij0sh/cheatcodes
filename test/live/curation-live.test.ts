import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PiQualifier } from "../../src/curate.js";
import type { HarvestPacket } from "../../src/harvest.js";
import { validateQualification, type QualificationResponse } from "../../src/qualify.js";

const model = process.env.CHEATCODES_LIVE_MODEL;
const baseline = Number(process.env.CHEATCODES_CURATION_PRECISION_BASELINE ?? "0.8");

function toPacket(fixture: { packet: Record<string, unknown> }): HarvestPacket {
  const p = fixture.packet;
  return {
    id: p.id as string,
    projectKey: "golden",
    sessionId: "golden",
    episodeId: "golden",
    recordIds: [],
    signals: (p.signals ?? []) as HarvestPacket["signals"],
    closure: p.closure as HarvestPacket["closure"],
    signalReasons: [],
    omittedEvidenceCount: 0,
    packetFitReason: "fit",
    userIntent: p.userIntent as string,
    finalAssistantSummary: p.finalAssistantSummary as string,
    evidence: p.evidence as HarvestPacket["evidence"],
    shortlist: (p.shortlist ?? []) as HarvestPacket["shortlist"],
    ...((p.updateCandidate ? { updateCandidate: p.updateCandidate } : {}) as Pick<HarvestPacket, "updateCandidate">),
  };
}

test("live curation evaluation over the golden set", { timeout: 900_000, skip: !model }, async () => {
  const dir = new URL("../fixtures/curation-golden/", import.meta.url);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  assert.equal(files.length >= 20, true);
  const qualifier = await PiQualifier.create({ projectRoot: process.cwd(), model: model! });
  const results: Array<{ name: string; expected: string; actual: string; ok: boolean }> = [];
  for (const file of files) {
      const fixture = JSON.parse(await readFile(path.join(dir.pathname, file), "utf8"));
      const packet = toPacket(fixture);
      const outcome = await qualifier.qualify(packet);
      let actual = "schema-invalid";
      let response: QualificationResponse | undefined;
      if (!outcome.schemaInvalid && outcome.response) {
        response = validateQualification(outcome.response, packet);
        actual = response.entries[0]?.verdict ?? "empty";
      }
      results.push({ name: fixture.name, expected: fixture.expect.verdict, actual, ok: actual === fixture.expect.verdict });
    }

  const precision = results.filter((r) => r.ok).length / results.length;
  console.log(`live curation precision: ${(precision * 100).toFixed(1)}% over ${results.length} fixtures`);
  for (const result of results.filter((r) => !r.ok)) console.log(`  miss: ${result.name}: expected ${result.expected}, got ${result.actual}`);
  assert.equal(precision >= baseline, true, `live precision ${precision} below baseline ${baseline}`);
});

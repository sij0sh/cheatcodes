import { createHash } from "node:crypto";
import type { NormalizedRecord, ParsedSession, ToolReceipt } from "./jsonl.js";
import { redactSecrets } from "./jsonl.js";

export const PACKET_CHARACTER_CAP = 12_000;
export const SHORTLIST_LIMIT = 8;

export type SignalKind = "resolved-failure" | "correction" | "workflow-checkpoint" | "decision" | "procedure";

export interface Episode {
  id: string;
  sessionId: string;
  records: NormalizedRecord[];
  recordIds: string[];
  hasNewRecord: boolean;
  signals: SignalKind[];
}

export interface EvidenceItem {
  id: string;
  kind: "message" | "tool" | "checkpoint";
  excerpt: string;
  recordIds: string[];
  path?: string;
}

export interface EntrySummary {
  id: string;
  title: string;
  summary: string;
  tags?: string[];
  body?: string;
}

export interface ShortlistItem {
  id: string;
  title: string;
  summary: string;
  score: number;
}

export interface UpdateCandidate extends ShortlistItem { body: string }

export interface HarvestPacket {
  id: string;
  projectKey: string;
  sessionId: string;
  episodeId: string;
  recordIds: string[];
  signals: SignalKind[];
  userIntent: string;
  finalAssistantSummary: string;
  evidence: EvidenceItem[];
  shortlist: ShortlistItem[];
  updateCandidate?: UpdateCandidate;
}

export interface HarvestOptions {
  projectKey: string;
  entries?: readonly EntrySummary[];
  packetCharacterCap?: number;
  shortlistLimit?: number;
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const stableId = (prefix: string, parts: readonly string[]): string => `${prefix}-${hash(parts.join("\0")).slice(0, 24)}`;

function workflowBoundary(record: NormalizedRecord): boolean {
  if (record.kind === "workflow") return true;
  return record.kind === "user" && /\bworkflow\b.*\b(?:run|node|step)\b/i.test(record.text ?? "");
}

export function segmentBranch(branch: readonly NormalizedRecord[], sessionId = branch[0]?.sessionId ?? "unknown"): Episode[] {
  const groups: NormalizedRecord[][] = [];
  let current: NormalizedRecord[] = [];
  const flush = (): void => { if (current.length) groups.push(current); current = []; };

  for (const record of branch) {
    if (workflowBoundary(record) && current.length) flush();
    if (record.kind === "user" && current.some((item) => item.kind === "user")) flush();
    current.push(record);
    if (record.kind === "assistant") flush();
    else if (record.kind === "workflow") flush();
  }
  flush();
  return groups.map((records) => makeEpisode(sessionId, records));
}

function makeEpisode(sessionId: string, records: NormalizedRecord[]): Episode {
  const recordIds = records.map((record) => record.id);
  return {
    id: stableId("episode", [sessionId, ...recordIds]), sessionId, records, recordIds,
    hasNewRecord: records.some((record) => record.isNew), signals: detectHighSignal(records),
  };
}

export function segmentSession(session: Pick<ParsedSession, "sessionId" | "branches">): Episode[] {
  const byId = new Map<string, Episode>();
  for (const branch of session.branches) {
    for (const episode of segmentBranch(branch, session.sessionId)) {
      const key = episode.recordIds.join("\0");
      if (!byId.has(key)) byId.set(key, episode);
    }
  }
  return [...byId.values()];
}

function receipts(records: readonly NormalizedRecord[]): ToolReceipt[] {
  return records.flatMap((record) => record.receipt ? [record.receipt] : []);
}

function hasOrderedFailureMutationSuccess(records: readonly NormalizedRecord[]): boolean {
  let failedAt = -1;
  let mutationAt = -1;
  for (let index = 0; index < records.length; index++) {
    const receipt = records[index]!.receipt;
    if (receipt?.validation === "failed" && failedAt < 0) failedAt = index;
    if (receipt?.mutation && failedAt >= 0 && index > failedAt) mutationAt = index;
    if (receipt?.validation === "passed" && mutationAt >= 0 && index > mutationAt) return true;
  }
  return false;
}

function correctionSignal(records: readonly NormalizedRecord[]): boolean {
  return records.some((record) => record.kind === "user" && /\b(?:no,?|not quite|incorrect|wrong|instead|must not|do not|don't|actually|correction|that's not|that is not|you (?:missed|should))\b/i.test(record.text ?? ""));
}

function acceptedCheckpoint(records: readonly NormalizedRecord[]): boolean {
  return records.some((record) => record.kind === "workflow" && record.receipt?.accepted === true &&
    (Boolean(record.receipt.summary) || record.receipt.decisions !== undefined || record.receipt.evidence !== undefined));
}

function implementationEvidence(records: readonly NormalizedRecord[]): boolean {
  return receipts(records).some((receipt) => receipt.mutation || receipt.validation === "passed");
}

function userAcceptance(records: readonly NormalizedRecord[]): boolean {
  return records.some((record) => record.kind === "user" && /\b(?:approved|accepted|looks good|that's right|that is right|yes,? (?:use|do|ship)|proceed with)\b/i.test(record.text ?? ""));
}

function explicitDecision(records: readonly NormalizedRecord[]): boolean {
  const language = records.some((record) => /\b(?:we (?:decided|choose|chose|will use)|decision is|use .{1,80} instead of|prefer .{1,80} over|rejected alternative|the approach is)\b/i.test(record.text ?? record.receipt?.summary ?? ""));
  return language && (userAcceptance(records) || acceptedCheckpoint(records) || implementationEvidence(records));
}

function explicitProcedure(records: readonly NormalizedRecord[]): boolean {
  const commands = receipts(records).filter((receipt) => Boolean(receipt.command)).length;
  const numbered = records.some((record) => /(?:^|\n)\s*(?:1[.)]|step\s+1\b)[\s\S]*(?:\n\s*(?:2[.)]|step\s+2\b))/i.test(record.text ?? ""));
  const confirmed = receipts(records).some((receipt) => receipt.validation === "passed") || userAcceptance(records);
  return confirmed && (commands >= 2 || numbered);
}

export function detectHighSignal(records: readonly NormalizedRecord[]): SignalKind[] {
  const signals: SignalKind[] = [];
  if (hasOrderedFailureMutationSuccess(records)) signals.push("resolved-failure");
  if (correctionSignal(records)) signals.push("correction");
  if (acceptedCheckpoint(records)) signals.push("workflow-checkpoint");
  if (explicitDecision(records)) signals.push("decision");
  if (explicitProcedure(records)) signals.push("procedure");
  return signals;
}

function cleanExcerpt(value: string, limit: number): string {
  const clean = redactSecrets(value).trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}\n[truncated]`;
}

function evidenceFor(record: NormalizedRecord): EvidenceItem | undefined {
  const receipt = record.receipt;
  let excerpt = record.text ?? receipt?.summary ?? receipt?.excerpt ?? receipt?.command ?? "";
  if (receipt && !excerpt) {
    excerpt = [receipt.tool, receipt.path, receipt.contentSha256, receipt.validation !== "none" ? receipt.validation : undefined]
      .filter(Boolean).join(" | ");
  }
  if (!excerpt) return undefined;
  const kind = record.kind === "workflow" ? "checkpoint" : receipt ? "tool" : "message";
  const digestParts = [record.sessionId, record.id, kind, receipt?.path ?? "", excerpt];
  return {
    id: stableId("evidence", digestParts), kind, excerpt: cleanExcerpt(excerpt, 1_500),
    recordIds: [record.id], path: receipt?.path,
  };
}

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []);
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const term of left) if (right.has(term)) count++;
  return count;
}

export function shortlistEntries(
  episode: Episode,
  entries: readonly EntrySummary[],
  limit = SHORTLIST_LIMIT,
): { shortlist: ShortlistItem[]; updateCandidate?: UpdateCandidate } {
  const episodeText = episode.records.map((record) => [record.text, record.receipt?.path, record.receipt?.command].filter(Boolean).join(" ")).join(" ");
  const episodeTerms = terms(episodeText);
  const ranked = entries.map((entry) => {
    const titleScore = overlap(episodeTerms, terms(entry.title)) * 4;
    const tagScore = overlap(episodeTerms, terms((entry.tags ?? []).join(" "))) * 3;
    const summaryScore = overlap(episodeTerms, terms(entry.summary));
    return { entry, item: { id: entry.id, title: entry.title, summary: entry.summary, score: titleScore + tagScore + summaryScore } };
  }).filter((item) => item.item.score > 0)
    .sort((a, b) => b.item.score - a.item.score || a.item.title.localeCompare(b.item.title) || a.item.id.localeCompare(b.item.id))
    .slice(0, Math.max(0, limit));
  const shortlist = ranked.map((item) => item.item);
  const candidate = ranked[0];
  const updateCandidate = candidate && candidate.entry.body
    ? { ...candidate.item, body: candidate.entry.body }
    : undefined;
  return { shortlist, updateCandidate };
}

export function createPacket(episode: Episode, options: HarvestOptions): HarvestPacket | undefined {
  if (!episode.hasNewRecord || episode.signals.length === 0) return undefined;
  const evidence = episode.records.flatMap((record) => {
    const item = evidenceFor(record);
    return item ? [item] : [];
  });
  const userIntent = episode.records.filter((record) => record.kind === "user").map((record) => record.text).filter(Boolean).join("\n\n");
  const finalAssistantSummary = [...episode.records].reverse().find((record) => record.kind === "assistant")?.text ?? "";
  const related = shortlistEntries(episode, options.entries ?? [], options.shortlistLimit ?? SHORTLIST_LIMIT);
  const id = stableId("packet", [options.projectKey, episode.sessionId, ...episode.records.flatMap((record) => [record.id, record.byteHash])]);
  const packet: HarvestPacket = {
    id, projectKey: options.projectKey, sessionId: episode.sessionId, episodeId: episode.id,
    recordIds: episode.recordIds, signals: episode.signals, userIntent: cleanExcerpt(userIntent, 3_000),
    finalAssistantSummary: cleanExcerpt(finalAssistantSummary, 3_000), evidence,
    shortlist: related.shortlist, updateCandidate: related.updateCandidate,
  };
  fitPacket(packet, options.packetCharacterCap ?? PACKET_CHARACTER_CAP);
  return packet;
}

function packetLength(packet: HarvestPacket): number { return JSON.stringify(packet).length; }

function fitPacket(packet: HarvestPacket, cap: number): void {
  for (let index = packet.evidence.length - 1; packetLength(packet) > cap && index >= 0; index--) {
    const evidence = packet.evidence[index]!;
    if (evidence.excerpt.length > 80) evidence.excerpt = cleanExcerpt(evidence.excerpt, 80);
  }
  while (packetLength(packet) > cap && packet.evidence.length > 1) packet.evidence.pop();
  while (packetLength(packet) > cap && packet.shortlist.length) packet.shortlist.pop();
  if (packetLength(packet) > cap) packet.finalAssistantSummary = cleanExcerpt(packet.finalAssistantSummary, Math.max(0, packet.finalAssistantSummary.length - (packetLength(packet) - cap)));
  if (packetLength(packet) > cap) packet.userIntent = cleanExcerpt(packet.userIntent, Math.max(0, packet.userIntent.length - (packetLength(packet) - cap)));
  if (packetLength(packet) > cap && packet.updateCandidate) delete packet.updateCandidate;
  if (packetLength(packet) > cap && packet.evidence[0]) packet.evidence[0].excerpt = "";
}

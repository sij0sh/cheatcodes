import { createHash } from "node:crypto";
import type { NormalizedRecord, ParsedSession, ToolReceipt } from "./jsonl.js";
import { WORKER_ORIGIN, redactSecrets } from "./jsonl.js";

export const PACKET_CHARACTER_CAP = 12_000;
export const SHORTLIST_LIMIT = 8;

export type SignalKind = "resolved-failure" | "correction" | "workflow-checkpoint" | "decision" | "procedure";

export type EpisodeClosure = "assistant-settled" | "workflow-terminal" | "user-superseded" | "incomplete";

export interface Episode {
  id: string;
  sessionId: string;
  closure: EpisodeClosure;
  eligible: boolean;
  branchLeafId?: string;
  records: NormalizedRecord[];
  recordIds: string[];
  hasNewRecord: boolean;
  signals: SignalKind[];
  signalReasons: string[];
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
  closure: EpisodeClosure;
  branchLeafId?: string;
  signalReasons: string[];
  omittedEvidenceCount: number;
  packetFitReason: string;
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

const CORRECTION_PATTERN = /\b(?:no,?|not quite|incorrect|wrong|instead|must not|do not|don't|actually|correction|that's not|that is not|you (?:missed|should))\b/i;

export function isCorrection(text: string | undefined): boolean {
  return Boolean(text && CORRECTION_PATTERN.test(text));
}

// Causal segmentation (guide 0.3): episodes start at substantive user records or workflow
// positions, keep corrections and retries inside the episode, close on settled responses or
// terminal workflow events, and mark trailing unmatched groups incomplete.
export function segmentBranch(branch: readonly NormalizedRecord[], sessionId = branch[0]?.sessionId ?? "unknown"): Episode[] {
  const episodes: Episode[] = [];
  let current: NormalizedRecord[] = [];
  const close = (closure: EpisodeClosure): void => {
    if (!current.length) return;
    const first = current[0]!;
    const initiated = first.kind === "user" || first.kind === "workflow";
    episodes.push(makeEpisode(sessionId, current, initiated ? closure : "incomplete"));
    current = [];
  };
  for (const record of branch) {
    if (record.kind === "user" && !isCorrection(record.text)) close("user-superseded");
    current.push(record);
    if (record.kind === "assistant") close("assistant-settled");
    else if (record.kind === "workflow" && record.receipt?.accepted === true) close("workflow-terminal");
  }
  close("incomplete");
  return episodes;
}

function makeEpisode(sessionId: string, records: NormalizedRecord[], closure: EpisodeClosure): Episode {
  const recordIds = records.map((record) => record.id);
  return {
    id: stableId("episode", [sessionId, ...recordIds]), sessionId, closure,
    eligible: closure === "assistant-settled" || closure === "workflow-terminal",
    branchLeafId: records.find((record) => record.branchLeafId)?.branchLeafId,
    records, recordIds,
    hasNewRecord: records.some((record) => record.isNew),
    signals: detectHighSignal(records), signalReasons: explainSignals(records),
  };
}

// Prefer the active branch (latest leaf); episodes holding records unique to abandoned
// branches never nominate knowledge, and branch ids stay preserved per record.
export function segmentSession(session: Pick<ParsedSession, "sessionId" | "branches">): Episode[] {
  if (session.branches.length === 0) return [];
  const active = session.branches.reduce((best, branch) => {
    const bestLeaf = best[best.length - 1]!;
    const leaf = branch[branch.length - 1]!;
    return `${leaf.timestamp ?? ""}\0${leaf.id}` > `${bestLeaf.timestamp ?? ""}\0${bestLeaf.id}` ? branch : best;
  });
  const activeIds = new Set(active.map((record) => record.id));
  const byId = new Map<string, Episode>();
  for (const branch of session.branches) {
    for (const episode of segmentBranch(branch, session.sessionId)) {
      if (episode.records.some((record) => !activeIds.has(record.id))) continue;
      const key = episode.recordIds.join("\0");
      if (!byId.has(key)) byId.set(key, episode);
    }
  }
  return [...byId.values()];
}

function receipts(records: readonly NormalizedRecord[]): ToolReceipt[] {
  return records.flatMap((record) => record.receipt ? [record.receipt] : []);
}

// A successful mutation mutates and did not error (guide 0.4 gate).
export function successfulMutation(receipt: ToolReceipt | undefined): boolean {
  return receipt?.mutation === true && receipt.isError !== true;
}

function isFailureReceipt(receipt: ToolReceipt | undefined): boolean {
  return receipt?.validation === "failed" || receipt?.isError === true;
}

function hasOrderedFailureMutationSuccess(records: readonly NormalizedRecord[]): boolean {
  let failedAt = -1;
  let mutationAt = -1;
  for (let index = 0; index < records.length; index++) {
    const receipt = records[index]!.receipt;
    if (receipt?.validation === "failed" && failedAt < 0) failedAt = index;
    if (failedAt >= 0 && index > failedAt && successfulMutation(receipt)) mutationAt = index;
    if (receipt?.validation === "passed" && mutationAt >= 0 && index > mutationAt) return true;
  }
  return false;
}

function correctionSignal(records: readonly NormalizedRecord[]): boolean {
  return records.some((record) => record.kind === "user" && isCorrection(record.text));
}

function acceptedCheckpoint(records: readonly NormalizedRecord[]): boolean {
  return records.some((record) => record.kind === "workflow" && record.receipt?.accepted === true &&
    (Boolean(record.receipt.summary) || record.receipt.decisions !== undefined || record.receipt.evidence !== undefined));
}

function implementationEvidence(records: readonly NormalizedRecord[]): boolean {
  return receipts(records).some((receipt) => successfulMutation(receipt) || receipt.validation === "passed");
}

function userAcceptance(records: readonly NormalizedRecord[]): boolean {
  return records.some((record) => record.kind === "user" && /\b(?:approved|accepted|looks good|that's right|that is right|yes,? (?:use|do|ship)|proceed with)\b/i.test(record.text ?? ""));
}

function decisionLanguage(record: NormalizedRecord): boolean {
  return /\b(?:we (?:decided|choose|chose|will use)|decision is|use .{1,80} instead of|prefer .{1,80} over|rejected alternative|the approach is)\b/i.test(record.text ?? record.receipt?.summary ?? "");
}

function explicitDecision(records: readonly NormalizedRecord[]): boolean {
  return records.some(decisionLanguage) && (userAcceptance(records) || acceptedCheckpoint(records) || implementationEvidence(records));
}

// A reusable procedure claim needs successfully validated commands; bare commands or user
// acceptance alone no longer qualify (guide 0.4).
function explicitProcedure(records: readonly NormalizedRecord[]): boolean {
  const numbered = records.some((record) => /(?:^|\n)\s*(?:1[.)]|step\s+1\b)[\s\S]*(?:\n\s*(?:2[.)]|step\s+2\b))/i.test(record.text ?? ""));
  const passedCommands = receipts(records).filter((receipt) => Boolean(receipt.command) && receipt.validation === "passed").length;
  return passedCommands >= 2 || (numbered && passedCommands >= 1);
}

// A workflow checkpoint may annotate an episode but cannot nominate it alone; a correction
// nominates review without establishing truth (guide 0.4).
export const NOMINATING_SIGNALS: readonly SignalKind[] = ["resolved-failure", "correction", "decision", "procedure"];

function evaluateSignals(records: readonly NormalizedRecord[]): { signals: SignalKind[]; reasons: string[] } {
  const signals: SignalKind[] = [];
  const reasons: string[] = [];
  const note = (signal: SignalKind, reason: string): void => { signals.push(signal); reasons.push(reason); };
  if (hasOrderedFailureMutationSuccess(records)) note("resolved-failure", "resolved-failure: failed validation, then successful mutation without error, then passed validation in one episode");
  if (correctionSignal(records)) note("correction", "correction: user correction nominates review but does not establish truth");
  if (acceptedCheckpoint(records)) note("workflow-checkpoint", "workflow-checkpoint: accepted checkpoint annotates the episode but cannot qualify it alone");
  if (explicitDecision(records)) note("decision", "decision: explicit decision language corroborated by settlement evidence");
  if (explicitProcedure(records)) note("procedure", "procedure: reusable procedure claim confirmed by successfully validated commands");
  return { signals, reasons };
}

export function detectHighSignal(records: readonly NormalizedRecord[]): SignalKind[] {
  return evaluateSignals(records).signals;
}

export function explainSignals(records: readonly NormalizedRecord[]): string[] {
  return evaluateSignals(records).reasons;
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
  if (!episode.hasNewRecord || !episode.eligible) return undefined;
  if (!episode.signals.some((signal) => NOMINATING_SIGNALS.includes(signal))) return undefined;
  if (episode.records.some((record) => record.origin === WORKER_ORIGIN)) return undefined;
  const prioritized = episode.records
    .map((record) => ({ record, item: evidenceFor(record) }))
    .filter((entry): entry is { record: NormalizedRecord; item: EvidenceItem } => entry.item !== undefined)
    .map((entry, index) => ({ item: entry.item, priority: evidencePriority(entry.record, index, episode.records) }));
  const evidence = prioritized.map((entry) => entry.item);
  const userIntent = episode.records.filter((record) => record.kind === "user").map((record) => record.text).filter(Boolean).join("\n\n");
  const finalAssistantSummary = [...episode.records].reverse().find((record) => record.kind === "assistant")?.text ?? "";
  const related = shortlistEntries(episode, options.entries ?? [], options.shortlistLimit ?? SHORTLIST_LIMIT);
  const id = stableId("packet", [options.projectKey, episode.sessionId, ...episode.records.flatMap((record) => [record.id, record.byteHash])]);
  const packet: HarvestPacket = {
    id, projectKey: options.projectKey, sessionId: episode.sessionId, episodeId: episode.id,
    recordIds: episode.recordIds, signals: episode.signals, signalReasons: episode.signalReasons,
    closure: episode.closure, branchLeafId: episode.branchLeafId,
    userIntent: cleanExcerpt(userIntent, 3_000),
    finalAssistantSummary: cleanExcerpt(finalAssistantSummary, 3_000), evidence,
    shortlist: related.shortlist, updateCandidate: related.updateCandidate,
    omittedEvidenceCount: 0, packetFitReason: "fit",
  };
  const fit = fitPacket(packet, options.packetCharacterCap ?? PACKET_CHARACTER_CAP, prioritized.map((entry) => entry.priority));
  if (!fit) return undefined; // the causal closure cannot fit; reject packet creation (guide 0.5)
  packet.omittedEvidenceCount = fit.omittedEvidenceCount;
  packet.packetFitReason = fit.packetFitReason;
  return packet;
}

type EvidencePriority = 1 | 2 | 3 | 4 | 5 | 6;

interface FitResult { omittedEvidenceCount: number; packetFitReason: string }

// Evidence priority (guide 0.5): 1 successful verification or terminal outcome, 2 correction or
// successful retry, 3 failure tied to that retry, 4 explicit decision, 5 current tool output,
// 6 setup and repeated context.
function evidencePriority(record: NormalizedRecord, index: number, records: readonly NormalizedRecord[]): EvidencePriority {
  const receipt = record.receipt;
  if (receipt?.validation === "passed" || receipt?.accepted === true) return 1;
  const earlierFailure = records.slice(0, index).some((other) => isFailureReceipt(other.receipt));
  if (successfulMutation(receipt) && earlierFailure) return 2;
  if (record.kind === "user" && isCorrection(record.text)) return 2;
  if (isFailureReceipt(receipt)) {
    const laterRecovery = records.slice(index + 1).some((other) =>
      successfulMutation(other.receipt) || other.receipt?.validation === "passed" || other.receipt?.accepted === true);
    return laterRecovery ? 3 : 6;
  }
  if (decisionLanguage(record)) return 4;
  if (receipt) return 5;
  return 6;
}

const overCap = (packet: HarvestPacket, cap: number): boolean => JSON.stringify(packet).length > cap;

// Fit order (guide 0.5): dedupe excerpts, shorten low-priority setup, remove old low-priority
// evidence, shorten shortlist summaries, reduce intent and final summary. A failure is never
// retained while its recovery is removed. Returns undefined when the closure still cannot fit.
function fitPacket(packet: HarvestPacket, cap: number, priorities: EvidencePriority[]): FitResult | undefined {
  let omitted = 0;
  const dropAt = (index: number): void => { packet.evidence.splice(index, 1); priorities.splice(index, 1); omitted++; };
  const seen = new Set<string>();
  for (let index = 0; index < packet.evidence.length;) {
    const key = packet.evidence[index]!.excerpt;
    if (seen.has(key)) dropAt(index); else { seen.add(key); index++; }
  }
  for (const limit of [300, 80]) {
    for (let index = 0; index < packet.evidence.length && overCap(packet, cap); index++) {
      if (priorities[index] === 6) packet.evidence[index]!.excerpt = cleanExcerpt(packet.evidence[index]!.excerpt, limit);
    }
  }
  for (const level of [6, 5, 4, 3, 2] as const) {
    while (overCap(packet, cap)) {
      const index = priorities.indexOf(level);
      if (index === -1) break;
      dropAt(index);
    }
  }
  while (overCap(packet, cap) && packet.shortlist.length) {
    const item = packet.shortlist[packet.shortlist.length - 1]!;
    if (item.summary.length > 120) item.summary = cleanExcerpt(item.summary, 120);
    else packet.shortlist.pop();
  }
  while (overCap(packet, cap) && packet.finalAssistantSummary.length > 80) {
    packet.finalAssistantSummary = cleanExcerpt(packet.finalAssistantSummary, Math.max(80, Math.floor(packet.finalAssistantSummary.length / 2)));
  }
  while (overCap(packet, cap) && packet.userIntent.length > 80) {
    packet.userIntent = cleanExcerpt(packet.userIntent, Math.max(80, Math.floor(packet.userIntent.length / 2)));
  }
  if (overCap(packet, cap)) return undefined;
  return { omittedEvidenceCount: omitted, packetFitReason: omitted > 0 ? "omitted-evidence" : "fit" };
}

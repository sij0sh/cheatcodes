import { createHash } from "node:crypto";

export type EntryKind = "gotcha" | "decision" | "procedure" | "invariant";

export interface KnowledgeEntry {
  id: string;
  title: string;
  summary: string;
  body: string;
  date?: string;
  tags?: string[];
  sources?: string[];
  kind?: EntryKind;
  verifiedAt?: string;
  verificationSources?: string[];
}

export interface CuratedEntryInput {
  action: "create" | "update";
  targetEntryId?: string;
  title: string;
  summary: string;
  body: string;
  date?: string;
  tags?: string[];
  sources?: string[];
}

export class KnowledgeValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid knowledge entry:\n- ${issues.join("\n- ")}`);
    this.name = "KnowledgeValidationError";
    this.issues = issues;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OPEN_MARKER = "<!-- cheatcodes-entry ";
const CLOSE_MARKER = "<!-- /cheatcodes-entry -->";
const DOCUMENT_HEADING = "# CHEATCODES";
export const RESERVED_TEXT = [OPEN_MARKER, CLOSE_MARKER, "-->"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${field} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function rejectReserved(value: string, field: string, issues: string[]): void {
  for (const marker of RESERVED_TEXT) {
    if (value.includes(marker)) {
      issues.push(`${field} must not contain reserved text: ${marker.trim()}`);
      return;
    }
  }
}

function normalizeMultiline(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function normalizeList(value: unknown, field: string, issues: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${field} must be a list of non-empty strings`);
    return [];
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    const itemText = requiredString(item, `${field}[${index}]`, issues);
    if (itemText && !result.includes(itemText)) result.push(itemText);
  });
  return result.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function optionalDate(value: unknown, issues: string[]): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") {
    issues.push("date must be an ISO 8601 datetime string");
    return undefined;
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    issues.push("date must be an ISO 8601 datetime string");
    return undefined;
  }
  return parsed.toISOString();
}

function optionalKind(value: unknown, issues: string[]): EntryKind | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "gotcha" || value === "decision" || value === "procedure" || value === "invariant") return value;
  issues.push("kind must be one of gotcha, decision, procedure, invariant");
  return undefined;
}

export function validateEntry(value: unknown): KnowledgeEntry {
  const issues: string[] = [];
  if (!isRecord(value)) throw new KnowledgeValidationError(["entry must be a mapping"]);

  const id = requiredString(value.id, "id", issues);
  if (id && !ID_PATTERN.test(id)) {
    issues.push("id may contain only letters, digits, dots, underscores, and hyphens");
  }
  const title = requiredString(value.title, "title", issues);
  const summary = requiredString(value.summary, "summary", issues);
  const body = requiredString(value.body, "body", issues);
  const date = optionalDate(value.date, issues);
  const tags = normalizeList(value.tags, "tags", issues);
  const sources = normalizeList(value.sources, "sources", issues);
  const kind = optionalKind(value.kind, issues);
  const verifiedAt = optionalDate(value.verifiedAt, issues);
  const verificationSources = normalizeList(value.verificationSources, "verificationSources", issues);

  for (const [field, text] of [["id", id], ["title", title], ["summary", summary], ["body", body]] as const) {
    if (text) rejectReserved(text, field, issues);
  }
  tags.forEach((tag, index) => rejectReserved(tag, `tags[${index}]`, issues));
  sources.forEach((source, index) => rejectReserved(source, `sources[${index}]`, issues));
  verificationSources.forEach((source, index) => rejectReserved(source, `verificationSources[${index}]`, issues));

  if (issues.length > 0) throw new KnowledgeValidationError(issues);
  const entry: KnowledgeEntry = { id, title, summary, body: normalizeMultiline(body) };
  if (date) entry.date = date;
  if (tags.length > 0) entry.tags = tags;
  if (sources.length > 0) entry.sources = sources;
  if (kind) entry.kind = kind;
  if (verifiedAt) entry.verifiedAt = verifiedAt;
  if (verificationSources.length > 0) entry.verificationSources = verificationSources;
  return entry;
}

interface EntryMetadata {
  id: string;
  title: string;
  summary: string;
  date?: string;
  tags?: string[];
  sources?: string[];
  kind?: EntryKind;
  verifiedAt?: string;
  verificationSources?: string[];
}

function metadataFor(entry: KnowledgeEntry): EntryMetadata {
  const metadata: EntryMetadata = { id: entry.id, title: entry.title, summary: entry.summary };
  if (entry.date) metadata.date = entry.date;
  if (entry.tags && entry.tags.length > 0) metadata.tags = entry.tags;
  if (entry.sources && entry.sources.length > 0) metadata.sources = entry.sources;
  if (entry.kind) metadata.kind = entry.kind;
  if (entry.verifiedAt) metadata.verifiedAt = entry.verifiedAt;
  if (entry.verificationSources && entry.verificationSources.length > 0) metadata.verificationSources = entry.verificationSources;
  return metadata;
}

function renderBlock(entry: KnowledgeEntry): string {
  const valid = validateEntry(entry);
  const metadata = JSON.stringify(metadataFor(valid));
  return [
    `${OPEN_MARKER}${metadata}-->`,
    `## ${valid.title}`,
    "",
    valid.summary,
    "",
    valid.body,
    "",
    CLOSE_MARKER,
    "",
  ].join("\n");
}

export function normalizeTitleKey(title: string): string {
  return title.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

function entryOrder(entry: KnowledgeEntry): string {
  return `${normalizeTitleKey(entry.title)}\u0000${entry.id}`;
}

export function renderKnowledgeMarkdown(entries: readonly KnowledgeEntry[]): string {
  const valid = entries.map((entry) => validateEntry(entry));
  valid.sort((a, b) => (entryOrder(a) < entryOrder(b) ? -1 : entryOrder(a) > entryOrder(b) ? 1 : 0));
  const blocks = valid.map((entry) => renderBlock(entry));
  return blocks.length > 0 ? `${DOCUMENT_HEADING}\n\n${blocks.join("")}` : `${DOCUMENT_HEADING}\n`;
}

function renderedPrefix(entry: KnowledgeEntry): string {
  return `## ${entry.title}\n\n${entry.summary}\n\n`;
}

export function parseKnowledgeMarkdown(markdown: string): KnowledgeEntry[] {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const entries: KnowledgeEntry[] = [];
  const ids = new Set<string>();
  let cursor = 0;
  for (;;) {
    const open = normalized.indexOf(OPEN_MARKER, cursor);
    if (open < 0) break;
    const metadataStart = open + OPEN_MARKER.length;
    const metadataEnd = normalized.indexOf("-->", metadataStart);
    if (metadataEnd < 0) throw new KnowledgeValidationError(["entry metadata must be closed with -->"]);
    let raw: unknown;
    const metadataText = normalized.slice(metadataStart, metadataEnd);
    try {
      raw = JSON.parse(metadataText);
    } catch {
      throw new KnowledgeValidationError([`entry metadata must be valid JSON: ${metadataText.slice(0, 80)}`]);
    }
    if (!isRecord(raw)) throw new KnowledgeValidationError(["entry metadata must be a JSON object"]);
    const blockStart = metadataEnd + 3;
    const blockEnd = normalized.indexOf(CLOSE_MARKER, blockStart);
    if (blockEnd < 0) throw new KnowledgeValidationError(["entry must be closed with a closing comment"]);
    const rendered = normalized.slice(blockStart, blockEnd).replace(/^\n/, "");
    const partial = validateEntry({ ...raw, body: "structural-placeholder" });
    const prefix = renderedPrefix(partial);
    if (!rendered.startsWith(prefix)) {
      throw new KnowledgeValidationError([`entry ${partial.id} must render its title and summary after the metadata`]);
    }
    const entry = validateEntry({ ...raw, body: rendered.slice(prefix.length) });
    if (ids.has(entry.id)) throw new KnowledgeValidationError([`duplicate entry id: ${entry.id}`]);
    ids.add(entry.id);
    entries.push(entry);
    cursor = blockEnd + CLOSE_MARKER.length;
  }
  return entries;
}

export function deriveEntryId(projectKey: string, title: string): string {
  const digest = createHash("sha256").update(`${projectKey}\u0000${normalizeTitleKey(title)}`).digest("hex");
  return `cc-${digest.slice(0, 24)}`;
}

function mergedValues(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  return [...new Set([...(existing ?? []), ...(incoming ?? [])])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sameEntry(a: KnowledgeEntry, b: KnowledgeEntry): boolean {
  return renderBlock(a) === renderBlock(b);
}

export function applyCuratedEntry(
  entries: readonly KnowledgeEntry[],
  input: CuratedEntryInput,
  projectKey: string,
): { entries: KnowledgeEntry[]; changed: boolean; id: string } {
  const issues: string[] = [];
  if (input.action !== "create" && input.action !== "update") issues.push("action must be create or update");
  if (issues.length > 0) throw new KnowledgeValidationError(issues);

  if (input.action === "update") {
    if (!input.targetEntryId) throw new KnowledgeValidationError(["update requires targetEntryId"]);
    const index = entries.findIndex((entry) => entry.id === input.targetEntryId);
    if (index < 0) throw new KnowledgeValidationError([`update target not found: ${input.targetEntryId}`]);
    const existing = entries[index]!;
    const next = validateEntry({
      id: existing.id,
      title: input.title,
      summary: input.summary,
      body: input.body,
      date: input.date ?? existing.date,
      tags: mergedValues(existing.tags, input.tags),
      sources: mergedValues(existing.sources, input.sources),
    });
    const changed = !sameEntry(existing, next);
    if (!changed) return { entries: [...entries], changed, id: existing.id };
    const updated = entries.slice();
    updated[index] = next;
    return { entries: updated, changed, id: next.id };
  }

  const id = deriveEntryId(projectKey, input.title);
  const entry = validateEntry({
    id,
    title: input.title,
    summary: input.summary,
    body: input.body,
    date: input.date,
    tags: input.tags,
    sources: input.sources,
  });
  const index = entries.findIndex((existing) => existing.id === id);
  if (index >= 0) {
    const existing = entries[index]!;
    if (normalizeTitleKey(existing.title) !== normalizeTitleKey(entry.title)) {
      throw new KnowledgeValidationError([`entry id ${id} already belongs to "${existing.title}"`]);
    }
    const merged = validateEntry({
      ...entry,
      date: input.date ?? existing.date,
      tags: mergedValues(existing.tags, entry.tags),
      sources: mergedValues(existing.sources, entry.sources),
    });
    const changed = !sameEntry(existing, merged);
    if (!changed) return { entries: [...entries], changed, id };
    const updated = entries.slice();
    updated[index] = merged;
    return { entries: updated, changed, id };
  }
  return { entries: [...entries, entry], changed: true, id };
}

const DIGEST_FIELDS = ["title", "summary", "body", "date", "tags", "sources", "kind", "verifiedAt", "verificationSources"] as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function entryDigest(entry: KnowledgeEntry): string {
  const normalized = validateEntry(entry);
  const content: Record<string, unknown> = {};
  for (const field of DIGEST_FIELDS) content[field] = stableValue(normalized[field]);
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function corpusRevision(entries: readonly KnowledgeEntry[]): string {
  const ordered = entries.map((entry) => ({ order: entryOrder(validateEntry(entry)), digest: entryDigest(entry) }));
  ordered.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return createHash("sha256").update(ordered.map((item) => item.digest).join("\n")).digest("hex");
}

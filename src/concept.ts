import { randomBytes } from "node:crypto";
import { parse, stringify } from "yaml";

export const CONCEPT_TYPES = ["Decision", "Gotcha", "Runbook"] as const;
export type ConceptType = (typeof CONCEPT_TYPES)[number];

export const CONCEPT_STATUSES = ["draft", "stable", "deprecated"] as const;
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];

export interface GeneratedMetadata {
  by: string;
  at?: string;
  [key: string]: unknown;
}

export interface Verification {
  by: string;
  at: string;
  [key: string]: unknown;
}

export interface ConceptSource {
  id: string;
  resource: string;
  title?: string;
  [key: string]: unknown;
}


export interface ConceptFrontmatter {
  cheatcodes_id: string;
  type: ConceptType;
  title: string;
  description: string;
  tags?: string[];
  status: ConceptStatus;
  generated: GeneratedMetadata;
  sources: ConceptSource[];
  verified?: Verification[];
  stale_after?: string;
  [key: string]: unknown;
}

export interface ConceptDocument {
  frontmatter: ConceptFrontmatter;
  
  body: string;
}

export type DecisionContent = {
  answer: string;
  rationale: string;
  rejectedAlternative?: string;
};

export type GotchaContent = {
  symptom: string;
  cause: string;
  fix: string;
  validation?: string;
};

export type RunbookContent = {
  purpose: string;
  steps: string[];
  validation?: string;
};

export type ConceptContent = DecisionContent | GotchaContent | RunbookContent;

export interface ConceptEvidence {
  id: string;
  excerpt: string;
  title?: string;
}

export interface CreateConceptInput {
  
  id?: string;
  type: ConceptType;
  title: string;
  description: string;
  tags?: string[];
  content: ConceptContent;
  sources: ConceptSource[];
  evidence?: ConceptEvidence[];
  generatedBy: string;
  generatedAt: string;
  
  extraFrontmatter?: Record<string, unknown>;
}

export interface AdditiveConceptUpdate {
  type: ConceptType;
  content: ConceptContent;
  tags?: string[];
  sources: ConceptSource[];
  evidence?: ConceptEvidence[];
  generatedAt: string;
  
  generatedBy?: string;
}

export interface AdditiveUpdateResult {
  concept: ConceptDocument;
  changed: boolean;
  contentAdded: boolean;
  provenanceAdded: boolean;
}

export class ConceptValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid concept:\n- ${issues.join("\n- ")}`);
    this.name = "ConceptValidationError";
    this.issues = issues;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function validateDatetime(value: unknown, path: string, issues: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !DATETIME_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push(`${path} must be an ISO 8601 datetime with a UTC offset`);
    return undefined;
  }
  return value;
}

function validateResource(value: unknown, path: string, issues: string[]): string {
  const resource = requiredString(value, path, issues);
  if (resource !== "" && /[\u0000-\u001f\u007f]/u.test(resource)) {
    issues.push(`${path} must not contain control characters`);
  }
  return resource;
}

function normalizeStringList(value: unknown, path: string, issues: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push(`${path} must be a list of non-empty strings`);
    return undefined;
  }
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = requiredString(value[index], `${path}[${index}]`, issues);
    if (item && !result.includes(item)) result.push(item);
  }
  return result;
}


export function validateConceptFrontmatter(value: unknown): ConceptFrontmatter {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ConceptValidationError(["frontmatter must be a mapping"]);

  const id = requiredString(value.cheatcodes_id, "cheatcodes_id", issues);
  if (id && !ID_PATTERN.test(id)) {
    issues.push("cheatcodes_id may contain only letters, digits, dots, underscores, and hyphens");
  }

  const rawType = requiredString(value.type, "type", issues);
  if (!CONCEPT_TYPES.includes(rawType as ConceptType)) {
    issues.push(`type must be one of ${CONCEPT_TYPES.join(", ")}`);
  }

  const rawStatus = requiredString(value.status, "status", issues);
  if (!CONCEPT_STATUSES.includes(rawStatus as ConceptStatus)) {
    issues.push(`status must be one of ${CONCEPT_STATUSES.join(", ")}`);
  }

  const title = requiredString(value.title, "title", issues);
  const description = requiredString(value.description, "description", issues);
  const tags = normalizeStringList(value.tags, "tags", issues);

  let generated: GeneratedMetadata = { by: "" };
  if (!isRecord(value.generated)) {
    issues.push("generated must be a mapping");
  } else {
    generated = {
      ...value.generated,
      by: requiredString(value.generated.by, "generated.by", issues),
    } as GeneratedMetadata;
    const at = validateDatetime(value.generated.at, "generated.at", issues);
    if (at !== undefined) generated.at = at;
    else if (value.generated.at !== undefined) delete generated.at;
  }

  const sources: ConceptSource[] = [];
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    issues.push("sources must be a non-empty list");
  } else {
    value.sources.forEach((source, index) => {
      if (!isRecord(source)) {
        issues.push(`sources[${index}] must be a mapping`);
        return;
      }
      const normalized: ConceptSource = {
        ...source,
        id: requiredString(source.id, `sources[${index}].id`, issues),
        resource: validateResource(source.resource, `sources[${index}].resource`, issues),
      } as ConceptSource;
      if (source.title !== undefined) {
        normalized.title = requiredString(source.title, `sources[${index}].title`, issues);
      }
      sources.push(normalized);
    });
  }
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) issues.push(`duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
  }

  let verified: Verification[] | undefined;
  if (value.verified !== undefined) {
    const events = Array.isArray(value.verified) ? value.verified : [value.verified];
    verified = [];
    events.forEach((event, index) => {
      if (!isRecord(event)) {
        issues.push(`verified[${index}] must be a mapping`);
        return;
      }
      verified!.push({
        ...event,
        by: requiredString(event.by, `verified[${index}].by`, issues),
        at: validateDatetime(event.at, `verified[${index}].at`, issues) ?? "",
      } as Verification);
    });
    if (verified.length === 0) issues.push("verified must contain at least one event");
  }

  const staleAfter = validateDatetime(value.stale_after, "stale_after", issues);
  if (issues.length > 0) throw new ConceptValidationError(issues);

  const normalized: Record<string, unknown> = { ...value };
  normalized.cheatcodes_id = id;
  normalized.type = rawType;
  normalized.title = title;
  normalized.description = description;
  normalized.status = rawStatus;
  normalized.generated = generated;
  normalized.sources = sources;
  if (tags !== undefined) normalized.tags = tags;
  if (verified !== undefined) normalized.verified = verified;
  if (staleAfter !== undefined) normalized.stale_after = staleAfter;
  return normalized as ConceptFrontmatter;
}


export function parseConceptMarkdown(markdown: string): ConceptDocument {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new ConceptValidationError(["document must start with YAML frontmatter"]);
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) throw new ConceptValidationError(["frontmatter must end with ---"]);

  const yamlText = normalized.slice(4, closing);
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConceptValidationError([`invalid YAML: ${message}`]);
  }
  const frontmatter = validateConceptFrontmatter(raw);
  const body = normalized.slice(closing + 5).trim();
  if (body === "") throw new ConceptValidationError(["body must be non-empty"]);
  return { frontmatter, body };
}


export function renderConceptMarkdown(concept: ConceptDocument): string {
  const frontmatter = validateConceptFrontmatter(concept.frontmatter);
  const body = concept.body.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new ConceptValidationError(["body must be non-empty"]);
  const yaml = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body}\n`;
}

export function generateConceptId(): string {
  return randomBytes(5).toString("hex");
}

function assertContent(type: ConceptType, content: ConceptContent): void {
  const issues: string[] = [];
  if (!isRecord(content)) throw new ConceptValidationError(["content must be a mapping"]);
  if (type === "Decision") {
    const decision = content as DecisionContent;
    requiredString(decision.answer, "content.answer", issues);
    requiredString(decision.rationale, "content.rationale", issues);
    if (decision.rejectedAlternative !== undefined) requiredString(decision.rejectedAlternative, "content.rejectedAlternative", issues);
  } else if (type === "Gotcha") {
    const gotcha = content as GotchaContent;
    requiredString(gotcha.symptom, "content.symptom", issues);
    requiredString(gotcha.cause, "content.cause", issues);
    requiredString(gotcha.fix, "content.fix", issues);
    if (gotcha.validation !== undefined) requiredString(gotcha.validation, "content.validation", issues);
  } else {
    const runbook = content as RunbookContent;
    requiredString(runbook.purpose, "content.purpose", issues);
    if (!Array.isArray(runbook.steps) || runbook.steps.length === 0) issues.push("content.steps must be a non-empty list");
    else runbook.steps.forEach((step, index) => requiredString(step, `content.steps[${index}]`, issues));
    if (runbook.validation !== undefined) requiredString(runbook.validation, "content.validation", issues);
  }
  if (issues.length) throw new ConceptValidationError(issues);
}

function section(level: number, title: string, text: string): string {
  return `${"#".repeat(level)} ${title}\n\n${text.trim()}`;
}


export function renderConceptBody(type: ConceptType, content: ConceptContent, evidence: ConceptEvidence[] = [], level = 1): string {
  assertContent(type, content);
  const sections: string[] = [];
  if (type === "Decision") {
    const decision = content as DecisionContent;
    sections.push(section(level, "Answer", decision.answer), section(level, "Why", decision.rationale));
    if (decision.rejectedAlternative) sections.push(section(level, "Rejected alternative", decision.rejectedAlternative));
  } else if (type === "Gotcha") {
    const gotcha = content as GotchaContent;
    sections.push(section(level, "Symptom", gotcha.symptom), section(level, "Cause", gotcha.cause), section(level, "Fix", gotcha.fix));
    if (gotcha.validation) sections.push(section(level, "Validation", gotcha.validation));
  } else {
    const runbook = content as RunbookContent;
    const steps = runbook.steps.map((step, index) => `${index + 1}. ${step.trim()}`).join("\n");
    sections.push(section(level, "Purpose", runbook.purpose), section(level, "Steps", steps));
    if (runbook.validation) sections.push(section(level, "Validation", runbook.validation));
  }

  if (evidence.length > 0) {
    const seen = new Set<string>();
    const lines = evidence.map((item, index) => {
      const id = requiredEvidence(item, index, seen);
      return `- [${id}] ${item.excerpt.trim()}`;
    });
    sections.push(section(level, "Evidence", lines.join("\n")));
  }
  return sections.join("\n\n");
}

function requiredEvidence(item: ConceptEvidence, index: number, seen: Set<string>): string {
  const issues: string[] = [];
  if (!isRecord(item)) throw new ConceptValidationError([`evidence[${index}] must be a mapping`]);
  const id = requiredString(item.id, `evidence[${index}].id`, issues);
  requiredString(item.excerpt, `evidence[${index}].excerpt`, issues);
  if (seen.has(id)) issues.push(`duplicate evidence id: ${id}`);
  seen.add(id);
  if (issues.length) throw new ConceptValidationError(issues);
  return id;
}


export function createConcept(input: CreateConceptInput): ConceptDocument {
  const id = input.id ?? generateConceptId();
  const frontmatter = validateConceptFrontmatter({
    ...input.extraFrontmatter,
    cheatcodes_id: id,
    type: input.type,
    title: input.title,
    description: input.description,
    tags: unique(input.tags ?? []),
    status: "draft",
    generated: { by: input.generatedBy, at: input.generatedAt },
    sources: input.sources,
  });
  return {
    frontmatter,
    body: renderConceptBody(input.type, input.content, input.evidence),
  };
}

export function createConceptMarkdown(input: CreateConceptInput): { id: string; concept: ConceptDocument; markdown: string } {
  const concept = createConcept(input);
  return {
    id: concept.frontmatter.cheatcodes_id,
    concept,
    markdown: renderConceptMarkdown(concept),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sourceKey(source: ConceptSource): string {
  return `${source.id}\u0000${source.resource}`;
}





export function applyAdditiveConceptUpdate(existing: ConceptDocument, update: AdditiveConceptUpdate): AdditiveUpdateResult {
  const current = validateConceptFrontmatter(existing.frontmatter);
  if (current.status !== "draft" || current.verified !== undefined) {
    throw new ConceptValidationError(["automatic updates require an unverified draft concept"]);
  }
  if (current.type !== update.type) {
    throw new ConceptValidationError([`update type ${update.type} does not match target type ${current.type}`]);
  }

  const addendumBody = renderConceptBody(update.type, update.content, update.evidence, 3);
  const addendum = `## Addendum\n\n${addendumBody}`;
  const updatesHeading = "# Updates";
  const existingBody = existing.body.replace(/\r\n?/g, "\n").trim();
  const contentAdded = !existingBody.includes(addendum);

  const sources = current.sources.map((source) => ({ ...source }));
  const sourceKeys = new Set(sources.map(sourceKey));
  const ids = new Map(sources.map((source) => [source.id, source.resource]));
  let provenanceAdded = false;
  for (const source of update.sources) {
    const validated = validateConceptFrontmatter({ ...current, sources: [source] }).sources[0]!;
    const priorResource = ids.get(validated.id);
    if (priorResource !== undefined && priorResource !== validated.resource) {
      throw new ConceptValidationError([`source id ${validated.id} refers to two resources`]);
    }
    const key = sourceKey(validated);
    if (!sourceKeys.has(key)) {
      sources.push(validated);
      sourceKeys.add(key);
      ids.set(validated.id, validated.resource);
      provenanceAdded = true;
    }
  }

  const tags = unique([...(current.tags ?? []), ...(update.tags ?? [])]);
  const tagsAdded = tags.length !== (current.tags ?? []).length;
  const changed = contentAdded || provenanceAdded || tagsAdded;
  if (!changed) return { concept: { frontmatter: current, body: existingBody }, changed, contentAdded, provenanceAdded };

  let body = existingBody;
  if (contentAdded) {
    body = body.includes(`\n${updatesHeading}\n`) || body.startsWith(`${updatesHeading}\n`)
      ? `${body}\n\n${addendum}`
      : `${body}\n\n${updatesHeading}\n\n${addendum}`;
  }
  const frontmatter = validateConceptFrontmatter({
    ...current,
    tags,
    sources,
    generated: contentAdded || provenanceAdded
      ? {
          ...current.generated,
          by: update.generatedBy ?? current.generated.by,
          at: update.generatedAt,
        }
      : current.generated,
  });
  return { concept: { frontmatter, body }, changed, contentAdded, provenanceAdded };
}


export const parseConcept = parseConceptMarkdown;
export const renderConcept = renderConceptMarkdown;
export const updateConceptAdditively = applyAdditiveConceptUpdate;

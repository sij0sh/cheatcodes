import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  CONCEPT_TYPES,
  ConceptDocument,
  ConceptType,
  parseConceptMarkdown,
} from "./concept.js";

export interface PublishOptions {
  
  projectRoot?: string;
  
  cheatcodesDir?: string;
  
  curatedDir?: string;
  
  knowledgeDir?: string;
}

export interface PublishedConcept {
  id: string;
  type: ConceptType;
  title: string;
  description: string;
  status: "draft" | "stable" | "deprecated";
  relativePath: string;
}

export interface PublishResult {
  changed: boolean;
  recoveredBackup: boolean;
  conceptCount: number;
  knowledgeDir: string;
}

export class PublishValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Cannot publish knowledge bundle:\n- ${issues.join("\n- ")}`);
    this.name = "PublishValidationError";
    this.issues = issues;
  }
}

type DesiredTree = Map<string, Buffer>;

type ResolvedPaths = {
  curatedDir: string;
  knowledgeDir: string;
  backupDir: string;
};

function resolvePaths(options: PublishOptions | string | undefined): ResolvedPaths {
  const normalized = typeof options === "string" ? { projectRoot: options } : (options ?? {});
  const projectRoot = path.resolve(normalized.projectRoot ?? process.cwd());
  const cheatcodesDir = path.resolve(projectRoot, normalized.cheatcodesDir ?? ".cheatcodes");
  const curatedDir = path.resolve(projectRoot, normalized.curatedDir ?? path.join(cheatcodesDir, "curated", "concepts"));
  const knowledgeDir = path.resolve(projectRoot, normalized.knowledgeDir ?? path.join(cheatcodesDir, "knowledge"));
  return { curatedDir, knowledgeDir, backupDir: `${knowledgeDir}.backup` };
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}


export async function recoverPublishBackup(options?: PublishOptions | string): Promise<boolean> {
  const { knowledgeDir, backupDir } = resolvePaths(options);
  if (!(await exists(backupDir))) return false;
  if (await exists(knowledgeDir)) {
    await rm(backupDir, { recursive: true, force: true });
  } else {
    await mkdir(path.dirname(knowledgeDir), { recursive: true });
    await rename(backupDir, knowledgeDir);
  }
  return true;
}

async function markdownFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const result: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new PublishValidationError([`symbolic links are not allowed in curated concepts: ${absolute}`]);
      }
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(absolute);
    }
  }

  await visit(root);
  return result;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedTitle(title: string): string {
  return title.normalize("NFKC").toLowerCase();
}

function markdownText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1").replace(/[\r\n]+/g, " ").trim();
}

function markdownDescription(value: string): string {
  return markdownText(value).replace(/\s+/g, " ");
}

function linkPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function renderRootIndex(): string {
  return [
    "---",
    'okf_version: "0.2"',
    "---",
    "",
    "# Project knowledge",
    "",
    "- [Concepts](concepts/) - Curated decisions, gotchas, and runbooks.",
    "",
  ].join("\n");
}


export function renderConceptIndex(concepts: readonly PublishedConcept[]): string {
  const lines = ["# Concepts", ""];
  for (const type of CONCEPT_TYPES) {
    const group = concepts
      .filter((concept) => concept.type === type)
      .sort((left, right) => {
        const titleOrder = compareText(normalizedTitle(left.title), normalizedTitle(right.title));
        return titleOrder || compareText(left.relativePath, right.relativePath);
      });
    if (group.length === 0) continue;
    lines.push(`## ${type}`, "");
    for (const concept of group) {
      lines.push(`- [${markdownText(concept.title)}](${linkPath(concept.relativePath)}) [${concept.status}] - ${markdownDescription(concept.description)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function buildDesiredTree(curatedDir: string): Promise<{ tree: DesiredTree; concepts: PublishedConcept[] }> {
  const tree: DesiredTree = new Map();
  const concepts: PublishedConcept[] = [];
  const issues: string[] = [];
  const ids = new Map<string, string>();
  const files = await markdownFiles(curatedDir);

  for (const filename of files) {
    const relative = path.relative(curatedDir, filename).split(path.sep).join("/");
    let bytes: Buffer;
    let document: ConceptDocument;
    try {
      bytes = await readFile(filename);
      document = parseConceptMarkdown(bytes.toString("utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`${relative}: ${message}`);
      continue;
    }

    const id = document.frontmatter.cheatcodes_id;
    const expectedName = `${id}.md`;
    if (relative !== expectedName) {
      issues.push(`${relative}: path must be exactly ${expectedName}`);
    }
    const previous = ids.get(id);
    if (previous !== undefined) issues.push(`${relative}: duplicate cheatcodes_id ${id} also used by ${previous}`);
    else ids.set(id, relative);

    tree.set(`concepts/${relative}`, bytes);
    concepts.push({
      id,
      type: document.frontmatter.type,
      title: document.frontmatter.title,
      description: document.frontmatter.description,
      status: document.frontmatter.status,
      relativePath: relative,
    });
  }

  if (issues.length > 0) throw new PublishValidationError(issues);
  tree.set("index.md", Buffer.from(renderRootIndex(), "utf8"));
  tree.set("concepts/index.md", Buffer.from(renderConceptIndex(concepts), "utf8"));
  return { tree, concepts };
}

async function readTree(root: string): Promise<DesiredTree | undefined> {
  if (!(await exists(root))) return undefined;
  const result: DesiredTree = new Map();

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.set(relative, await readFile(absolute));
      else throw new PublishValidationError([`generated bundle contains an unsupported entry: ${relative}`]);
    }
  }

  await visit(root);
  return result;
}

function treesEqual(left: DesiredTree | undefined, right: DesiredTree): boolean {
  if (left === undefined || left.size !== right.size) return false;
  for (const [name, bytes] of right) {
    const actual = left.get(name);
    if (actual === undefined || !actual.equals(bytes)) return false;
  }
  return true;
}

async function writeTree(root: string, tree: DesiredTree): Promise<void> {
  await mkdir(root, { recursive: false });
  const names = [...tree.keys()].sort(compareText);
  for (const name of names) {
    const target = path.join(root, ...name.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, tree.get(name)!, { flag: "wx" });
  }
}


export async function publishKnowledge(options?: PublishOptions | string): Promise<PublishResult> {
  const paths = resolvePaths(options);
  const recoveredBackup = await recoverPublishBackup(options);
  const { tree, concepts } = await buildDesiredTree(paths.curatedDir);
  const current = await readTree(paths.knowledgeDir);
  if (treesEqual(current, tree)) {
    return {
      changed: false,
      recoveredBackup,
      conceptCount: concepts.length,
      knowledgeDir: paths.knowledgeDir,
    };
  }

  await mkdir(path.dirname(paths.knowledgeDir), { recursive: true });
  const stageDir = `${paths.knowledgeDir}.staging-${process.pid}-${randomUUID()}`;
  let oldMoved = false;
  try {
    await writeTree(stageDir, tree);
    const staged = await readTree(stageDir);
    if (!treesEqual(staged, tree)) throw new Error("staged knowledge bundle failed byte validation");

    if (await exists(paths.knowledgeDir)) {
      await rename(paths.knowledgeDir, paths.backupDir);
      oldMoved = true;
    }
    try {
      await rename(stageDir, paths.knowledgeDir);
    } catch (error) {
      if (oldMoved && !(await exists(paths.knowledgeDir)) && await exists(paths.backupDir)) {
        await rename(paths.backupDir, paths.knowledgeDir);
        oldMoved = false;
      }
      throw error;
    }
    if (oldMoved) {
      await rm(paths.backupDir, { recursive: true, force: true });
      oldMoved = false;
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }

  return {
    changed: true,
    recoveredBackup,
    conceptCount: concepts.length,
    knowledgeDir: paths.knowledgeDir,
  };
}

export const publish = publishKnowledge;
export const publishKnowledgeBundle = publishKnowledge;

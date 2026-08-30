import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { sessionHeaderFromRecord } from "./jsonl.js";
import type { FileCursor } from "./state.js";

export interface SessionCandidate {
  file: string;
  size: number;
  mtimeMs: number;
}

export interface ScanWarning { file: string; message: string }
export interface ScanResult { changed: SessionCandidate[]; unchanged: string[]; skipped: ScanWarning[]; missing: string[] }

const SKIPPED_DIRECTORIES = new Set([".cheatcodes", ".git", "node_modules"]);

async function discoverJsonl(directory: string, output: string[], warnings: ScanWarning[]): Promise<void> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { warnings.push({ file: directory, message: `Cannot scan input: ${(error as Error).message}` }); return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) await discoverJsonl(target, output, warnings);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(path.resolve(target));
  }
}

async function readHeader(file: string): Promise<{ id: string; cwd: string; version: number }> {
  const handle = await open(file, "r");
  try {
    let bytes = Buffer.alloc(4096);
    let content = Buffer.alloc(0);
    let position = 0;
    let parsedThrough = 0;
    while (content.length < 1024 * 1024) {
      const result = await handle.read(bytes, 0, bytes.length, position);
      if (!result.bytesRead) break;
      content = Buffer.concat([content, bytes.subarray(0, result.bytesRead)]);
      for (let newline = content.indexOf(0x0a, parsedThrough); newline >= 0; newline = content.indexOf(0x0a, parsedThrough)) {
        const value = JSON.parse(content.subarray(parsedThrough, newline).toString("utf8")) as Record<string, unknown>;
        const header = sessionHeaderFromRecord(value);
        if (header) {
          if (!header.cwd) throw new Error("invalid session metadata");
          return { id: header.id, cwd: header.cwd, version: header.version };
        }
        parsedThrough = newline + 1;
      }
      position += result.bytesRead;
      bytes = Buffer.alloc(Math.min(bytes.length * 2, 65536));
    }
    throw new Error("valid Pi or Claude session metadata was not found");
  } finally { await handle.close(); }
}

function matchProjectRoot(cwd: string, roots: string[]): string | undefined {
  const absolute = path.resolve(cwd);
  return roots
    .filter((root) => {
      const relative = path.relative(root, absolute);
      return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    })
    .sort((a, b) => b.length - a.length)[0];
}

export async function scanInputs(inputs: string[], projectRoots: string[], files: Record<string, FileCursor>): Promise<ScanResult> {
  const discovered: string[] = [];
  const skipped: ScanWarning[] = [];
  const missing: string[] = [];
  for (const input of [...new Set(inputs.map((value) => path.resolve(value)))].sort()) {
    let metadata;
    try { metadata = await stat(input); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { missing.push(input); continue; }
      skipped.push({ file: input, message: `Cannot scan input: ${(error as Error).message}` });
      continue;
    }
    if (metadata.isDirectory()) await discoverJsonl(input, discovered, skipped);
    else if (input.endsWith(".jsonl")) discovered.push(input);
    else skipped.push({ file: input, message: "Input is neither a directory nor a .jsonl file" });
  }
  const changed: SessionCandidate[] = [];
  const unchanged: string[] = [];
  for (const file of [...new Set(discovered)].sort()) {
    let metadata;
    try { metadata = await stat(file); } catch (error) { skipped.push({ file, message: `Cannot stat session: ${(error as Error).message}` }); continue; }
    const cursor = files[file];
    if (cursor && cursor.observedSize === metadata.size && cursor.mtimeMs === metadata.mtimeMs) { unchanged.push(file); continue; }
    try {
      const header = await readHeader(file);
      if (!matchProjectRoot(header.cwd, projectRoots)) { skipped.push({ file, message: "Session cwd is outside configured project roots" }); continue; }
      changed.push({ file, size: metadata.size, mtimeMs: metadata.mtimeMs });
    } catch (error) { skipped.push({ file, message: `Cannot read session header: ${(error as Error).message}` }); }
  }
  return { changed, unchanged, skipped, missing };
}

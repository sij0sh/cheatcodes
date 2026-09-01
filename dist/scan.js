import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { WORKER_ORIGIN, sessionHeaderFromRecord } from "./jsonl.js";
const SKIPPED_DIRECTORIES = new Set([".cheatcodes", ".git", "node_modules"]);
async function discoverJsonl(directory, output, warnings) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) {
        warnings.push({ file: directory, message: `Cannot scan input: ${error.message}` });
        return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        if (entry.isSymbolicLink())
            continue;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
            await discoverJsonl(target, output, warnings);
        else if (entry.isFile() && entry.name.endsWith(".jsonl"))
            output.push(path.resolve(target));
    }
}
async function readHeader(file) {
    const handle = await open(file, "r");
    try {
        let bytes = Buffer.alloc(4096);
        let content = Buffer.alloc(0);
        let position = 0;
        let parsedThrough = 0;
        while (content.length < 1024 * 1024) {
            const result = await handle.read(bytes, 0, bytes.length, position);
            if (!result.bytesRead)
                break;
            content = Buffer.concat([content, bytes.subarray(0, result.bytesRead)]);
            for (let newline = content.indexOf(0x0a, parsedThrough); newline >= 0; newline = content.indexOf(0x0a, parsedThrough)) {
                const value = JSON.parse(content.subarray(parsedThrough, newline).toString("utf8"));
                const header = sessionHeaderFromRecord(value);
                if (header) {
                    if (!header.cwd)
                        throw new Error("invalid session metadata");
                    return { id: header.id, cwd: header.cwd, version: header.version, origin: header.origin };
                }
                parsedThrough = newline + 1;
            }
            position += result.bytesRead;
            bytes = Buffer.alloc(Math.min(bytes.length * 2, 65536));
        }
        throw new Error("valid Pi session metadata was not found");
    }
    finally {
        await handle.close();
    }
}
function matchProjectRoot(cwd, roots) {
    // Headers recorded on another platform (e.g. Windows "C:\\..." read on POSIX) are not
    // absolute here; resolving them would silently place them inside the current project.
    if (!path.isAbsolute(cwd))
        return undefined;
    const absolute = path.resolve(cwd);
    return roots
        .filter((root) => {
        const relative = path.relative(root, absolute);
        return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    })
        .sort((a, b) => b.length - a.length)[0];
}
export async function scanInputs(inputs, projectRoots, files) {
    const discovered = [];
    const skipped = [];
    const missing = [];
    const foreignSessionIds = [];
    for (const input of [...new Set(inputs.map((value) => path.resolve(value)))].sort()) {
        let metadata;
        try {
            metadata = await stat(input);
        }
        catch (error) {
            if (error.code === "ENOENT") {
                missing.push(input);
                continue;
            }
            skipped.push({ file: input, message: `Cannot scan input: ${error.message}` });
            continue;
        }
        if (metadata.isDirectory())
            await discoverJsonl(input, discovered, skipped);
        else if (input.endsWith(".jsonl"))
            discovered.push(input);
        else
            skipped.push({ file: input, message: "Input is neither a directory nor a .jsonl file" });
    }
    const changed = [];
    const unchanged = [];
    for (const file of [...new Set(discovered)].sort()) {
        let metadata;
        try {
            metadata = await stat(file);
        }
        catch (error) {
            skipped.push({ file, message: `Cannot stat session: ${error.message}` });
            continue;
        }
        const cursor = files[file];
        if (cursor && cursor.observedSize === metadata.size && cursor.mtimeMs === metadata.mtimeMs) {
            unchanged.push(file);
            continue;
        }
        try {
            const header = await readHeader(file);
            if (header.origin === WORKER_ORIGIN) {
                skipped.push({ file, message: "cheatcodes-worker session excluded from harvest" });
                continue;
            }
            if (!matchProjectRoot(header.cwd, projectRoots)) {
                foreignSessionIds.push(header.id);
                skipped.push({ file, message: "Session cwd is outside configured project roots" });
                continue;
            }
            changed.push({ file, size: metadata.size, mtimeMs: metadata.mtimeMs });
        }
        catch (error) {
            skipped.push({ file, message: `Cannot read session header: ${error.message}` });
        }
    }
    return { changed, unchanged, skipped, missing, foreignSessionIds: [...new Set(foreignSessionIds)].sort() };
}

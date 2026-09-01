import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./state.js";
export const TREE_LIMITS = { depth: 4, entries: 400, bytes: 16_384 };
export const SKIP_DIRS = new Set([
    ".git", "node_modules", "dist", "build", "out", "coverage", ".cache",
    ".agents", ".cheatcodes", ".pi-files", "vendor", ".venv", "__pycache__",
]);
// Depth-first with sorted names; the flat output is already lexicographic.
// Symlinks are skipped outright so the walk cannot escape the root.
async function walk(root, relative, depth, state) {
    if (depth > TREE_LIMITS.depth || state.entries.length >= TREE_LIMITS.entries) {
        return state.entries.length >= TREE_LIMITS.entries;
    }
    let dirents;
    try {
        dirents = await readdir(relative ? path.join(root, relative) : root, { withFileTypes: true });
    }
    catch {
        return false;
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
        if (state.entries.length >= TREE_LIMITS.entries)
            return true;
        if (dirent.isSymbolicLink())
            continue;
        const rel = relative ? `${relative}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
            if (SKIP_DIRS.has(dirent.name))
                continue;
            state.entries.push({ path: `${rel}/` });
            if (await walk(root, rel, depth + 1, state))
                return true;
        }
        else if (dirent.isFile()) {
            const info = await stat(path.join(root, rel)).catch(() => undefined);
            const content = await readFile(path.join(root, rel), "utf8").catch(() => undefined);
            state.entries.push({ path: rel, bytes: info?.size ?? 0, ...(content !== undefined ? { sha256: sha256(content) } : {}) });
            state.files.count += 1;
        }
    }
    return false;
}
export async function walkInventory(root) {
    const rootReal = await realpath(root).catch(() => root);
    const state = { entries: [], files: { count: 0 } };
    const hitCap = await walk(rootReal, "", 0, state);
    return { root: path.basename(rootReal), entries: state.entries, totalFiles: state.files.count, truncated: hitCap };
}
// Covers structure (added and removed files, size changes) and content edits
// of every bounded file, so an ensure never misses a map-staling change.
export async function inventoryDigest(root) {
    const inventory = await walkInventory(root);
    return sha256(JSON.stringify(inventory.entries.map((entry) => [entry.path, entry.bytes ?? -1, entry.sha256 ?? ""])));
}

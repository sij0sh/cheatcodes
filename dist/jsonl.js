import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
export const RECEIPT_EXCERPT_LIMIT = 1_200;
export const WORKER_ORIGIN = "cheatcodes-worker";
const WORKER_ENTRY_TYPES = new Set(["choreograph", "cheatcodes-worker"]);
export function isWorkerEntry(value) {
    const raw = asObject(value);
    if (!raw)
        return false;
    if (asString(raw.origin) === WORKER_ORIGIN)
        return true;
    return raw.type === "custom" && WORKER_ENTRY_TYPES.has(asString(raw.customType) ?? "");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const asObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
const asString = (value) => typeof value === "string" ? value : undefined;
const asBoolean = (value) => typeof value === "boolean" ? value : undefined;
const asNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const sourceRecordId = (value) => asString(value.id);
const sourceParentId = (value) => asString(value.parentId);
export function sessionHeaderFromRecord(value) {
    const raw = asObject(value);
    if (!raw)
        return undefined;
    if (raw.type !== "session" || !asString(raw.id))
        return undefined;
    return {
        type: "session",
        version: asNumber(raw.version) ?? 1,
        id: asString(raw.id),
        timestamp: asString(raw.timestamp),
        cwd: asString(raw.cwd),
        origin: asString(raw.origin) === WORKER_ORIGIN ? "cheatcodes-worker" : undefined,
    };
}
export function textContent(value) {
    if (typeof value === "string")
        return value;
    if (!Array.isArray(value))
        return "";
    return value.flatMap((item) => {
        const block = asObject(item);
        return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
    }).join("\n");
}
export function redactSecrets(input) {
    if (!input)
        return input;
    let value = input;
    value = value.replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]");
    value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]");
    value = value.replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED API KEY]");
    value = value.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED API KEY]");
    value = value.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED JWT]");
    value = value.replace(/\b(?:gh[opusr]|github_pat)_[A-Za-z0-9_]{16,}\b/g, "[REDACTED TOKEN]");
    value = value.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED AWS KEY]");
    value = value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[REDACTED]@[REDACTED-HOST]/");
    value = value.replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY))\s*=\s*(?:(['"])[\s\S]*?\2|[^\s;&|]+)/gi, "$1=[REDACTED]");
    value = value.replace(/(["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]");
    return value;
}
function pathInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) ? relative : undefined;
}
export function normalizeRepositoryPath(candidate, projectId, projectRoots, cwd = process.cwd()) {
    if (!candidate || candidate.includes("\0"))
        return undefined;
    const absolute = path.resolve(cwd, candidate.replace(/^file:\/\//, ""));
    const matches = projectRoots
        .map((root) => path.resolve(root))
        .map((root) => ({ root, relative: pathInside(root, absolute) }))
        .filter((match) => match.relative !== undefined)
        .sort((a, b) => b.root.length - a.root.length);
    const match = matches[0];
    if (!match)
        return undefined;
    const relative = match.relative.split(path.sep).join("/");
    return `repo://${projectId}${relative ? `/${relative}` : ""}`;
}
function compactExcerpt(value, limit = RECEIPT_EXCERPT_LIMIT) {
    const safe = redactSecrets(value).replace(/(?:data:[^;,]+;base64,|base64[:=]\s*)[A-Za-z0-9+/=]{80,}/gi, "[OMITTED BASE64]");
    return safe.length <= limit ? safe : `${safe.slice(0, limit)}\n[truncated]`;
}
function firstPath(args) {
    for (const key of ["path", "file", "filePath", "file_path", "target", "cwd"]) {
        if (typeof args[key] === "string")
            return args[key];
    }
    return undefined;
}
function normalizePossiblePaths(text, options) {
    if (!options.projectId || !options.projectRoots?.length)
        return redactSecrets(text);
    const roots = [...options.projectRoots].map((root) => path.resolve(root)).sort((a, b) => b.length - a.length);
    let result = redactSecrets(text);
    for (const root of roots) {
        const identity = normalizeRepositoryPath(root, options.projectId, roots, options.cwd);
        if (!identity)
            continue;
        const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result.replace(new RegExp(`${escaped}(?=$|[\\/\\s'\"\x60),;])`, "g"), identity);
    }
    result = result.replace(/(?:\/home\/[^/\s]+|\/Users\/[^/\s]+)(?:\/[^\s'"`),;]*)?/g, "[ABSOLUTE PATH]");
    return result;
}
function isSimpleCommand(command) {
    return !/(?:\||&&|;|\|\||`|\$\(|\n|\b(?:sh|bash|zsh)\s+-c\b)/.test(command);
}
function looksLikeValidation(command) {
    return /(?:^|\s)(?:test|tests|pytest|cargo\s+test|npm\s+(?:test|run\s+(?:test|lint|build|check))|pnpm\s+(?:test|lint|build)|yarn\s+(?:test|lint|build)|tsc|eslint|ruff|mypy|go\s+test|dotnet\s+test|make\s+(?:test|check)|gradle\s+test)(?:\s|$)/i.test(command);
}
function validationState(command, exitCode, isError, structuredSummary) {
    if (!looksLikeValidation(command))
        return "none";
    if (exitCode !== undefined && isSimpleCommand(command))
        return exitCode === 0 ? "passed" : "failed";
    if (isError === true)
        return "failed";
    if (structuredSummary) {
        const outcome = structuredSummary.trim().toLowerCase();
        if (/^(?:passed|pass|success(?:ful)?)$/.test(outcome))
            return "passed";
        if (/^(?:failed|failure|error|errored)$/.test(outcome))
            return "failed";
        if (/\b(?:passed|success(?:ful)?|all checks? pass(?:ed)?)\b/i.test(structuredSummary) && !/\b(?:failed|failure|error)s?\b/i.test(structuredSummary))
            return "passed";
    }
    return "ambiguous";
}
function makeReceipt(tool, args, result, options) {
    const resultText = textContent(result?.content);
    const details = asObject(result?.details);
    const exitCode = asNumber(result?.exitCode) ?? asNumber(details?.exitCode) ?? asNumber(asObject(details?.ptcValue)?.exitCode);
    const isError = asBoolean(result?.isError);
    const rawPath = firstPath(args);
    const normalizedPath = rawPath && options.projectId && options.projectRoots
        ? normalizeRepositoryPath(rawPath, options.projectId, options.projectRoots, options.cwd)
        : rawPath ? compactExcerpt(rawPath, 500) : undefined;
    const commandRaw = asString(args.command) ?? asString(args.cmd) ?? "";
    const command = commandRaw ? normalizePossiblePaths(commandRaw, options) : undefined;
    const mutation = /^(?:edit|write|apply_patch|patch|delete|move|rename)$/i.test(tool);
    const receipt = {
        toolCallId: asString(result?.toolCallId), tool, path: normalizedPath,
        command: command ? compactExcerpt(command, 1_000) : undefined,
        exitCode, isError, mutation,
        validation: validationState(commandRaw, exitCode, isError, asString(details?.summary) ?? asString(details?.status) ?? asString(asObject(asObject(details?.contextHygiene)?.commandState)?.outcome)),
    };
    if (/^(?:read|write)$/i.test(tool)) {
        const content = asString(args.content) ?? resultText;
        if (content)
            receipt.contentSha256 = sha256(content);
    }
    else if (/^(?:edit|apply_patch|patch)$/i.test(tool)) {
        const patch = asString(args.patch) ?? asString(args.new_text) ?? asString(args.content) ?? resultText;
        if (patch)
            receipt.excerpt = compactExcerpt(normalizePossiblePaths(patch, options));
    }
    else if (/^(?:bash|shell|exec)$/i.test(tool)) {
        if (resultText && !/PRIVATE KEY|\b(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=/i.test(resultText)) {
            receipt.excerpt = compactExcerpt(normalizePossiblePaths(resultText, options));
        }
    }
    if (tool === "workflow_transition") {
        const source = { ...args, ...(details ?? {}) };
        const status = asString(source.status) ?? asString(source.verdict) ?? asString(source.outcome);
        receipt.accepted = asBoolean(source.accepted) ?? (status ? /^(?:accepted|complete|completed|success|passed)$/i.test(status) : false);
        receipt.node = asString(source.node) ?? asString(source.nodeId) ?? asString(source.to);
        receipt.summary = compactExcerpt(asString(source.summary) ?? resultText, 1_000);
        receipt.decisions = source.decisions;
        receipt.evidence = source.evidence;
    }
    return receipt;
}
function substantiveUser(text) {
    const clean = text.trim();
    return clean.length >= 8 && !/^(?:continue workflow|continue the workflow|run completion|<dcp-|\/?compact\b)/i.test(clean);
}
function recordIdFor(line, header, version) {
    const synthetic = `v1-${sha256(`${header.id}:${line.range.start}:${line.range.end}:${line.hash}`).slice(0, 24)}`;
    return version <= 1 ? synthetic : sourceRecordId(line.value) ?? synthetic;
}
// Turn ids derive deterministically from the assistant message that initiates each turn.
function turnInitiatorIds(lines, header, version) {
    const initiators = new Map();
    const userLines = new Set();
    let current;
    for (const line of lines) {
        const message = asObject(line.value.message);
        const role = asString(message?.role);
        if (role === "user") {
            if (substantiveUser(textContent(message?.content))) {
                userLines.add(line.index);
                current = undefined;
            }
        }
        else if (role === "assistant" && !current) {
            current = recordIdFor(line, header, version);
        }
        if (current)
            initiators.set(line.index, current);
    }
    let next;
    for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index];
        if (initiators.has(line.index))
            next = initiators.get(line.index);
        if (userLines.has(line.index) && next)
            initiators.set(line.index, next);
    }
    return initiators;
}
function normalizedFromRaw(lines, header, options) {
    const version = header.version || 1;
    const calls = new Map();
    const turnInitiators = turnInitiatorIds(lines, header, version);
    for (const line of lines) {
        const message = asObject(line.value.message);
        if (message?.role !== "assistant" || !Array.isArray(message.content))
            continue;
        for (const item of message.content) {
            const block = asObject(item);
            if (!block || block.type !== "toolCall")
                continue;
            const id = asString(block.id) ?? asString(block.toolCallId);
            const tool = asString(block.name) ?? asString(block.toolName);
            if (id && tool)
                calls.set(id, { tool, args: asObject(block.arguments) ?? {} });
        }
    }
    const retained = [];
    for (const line of lines) {
        const raw = line.value;
        const message = asObject(raw.message);
        const role = asString(message?.role);
        const id = recordIdFor(line, header, version);
        const base = {
            id, parentId: null, sourceParentId: sourceParentId(raw) ?? null, sessionId: header.id,
            timestamp: asString(raw.timestamp), range: line.range, byteHash: line.hash,
            isNew: options.rewritten === true || line.range.end > (options.previousCommittedOffset ?? 0),
        };
        const linkage = {
            turnId: turnInitiators.get(line.index),
            ...(header.origin === WORKER_ORIGIN || asString(raw.origin) === WORKER_ORIGIN ? { origin: WORKER_ORIGIN } : {}),
        };
        if (raw.type === "message" && role === "user") {
            const text = normalizePossiblePaths(textContent(message?.content), options).trim();
            if (substantiveUser(text))
                retained.push({ ...base, ...linkage, kind: "user", role, text });
        }
        else if (raw.type === "message" && role === "assistant" && asString(message?.stopReason) === "stop") {
            const text = normalizePossiblePaths(textContent(message?.content), options).trim();
            if (text)
                retained.push({ ...base, ...linkage, kind: "assistant", role, text: compactExcerpt(text, 4_000), assistantStopReason: asString(message?.stopReason) });
        }
        else if (raw.type === "message" && role === "toolResult") {
            const callId = asString(message?.toolCallId);
            const call = callId ? calls.get(callId) : undefined;
            const tool = asString(message?.toolName) ?? call?.tool;
            if (!tool)
                continue;
            const receipt = makeReceipt(tool, call?.args ?? {}, message, options);
            receipt.toolCallId = callId;
            if (message?.isError === true && /^(?:read|ls|list|find)$/i.test(tool))
                continue;
            if (/^(?:ls|list|find|grep|search)$/i.test(tool))
                continue;
            retained.push({ ...base, ...linkage, kind: tool === "workflow_transition" ? "workflow" : "tool", role, toolCallId: callId, receipt });
        }
        else if (raw.type === "message" && role === "bashExecution") {
            const command = asString(message?.command) ?? "";
            const receipt = makeReceipt("bash", { command }, message, options);
            retained.push({ ...base, ...linkage, kind: "bash", role, receipt });
        }
    }
    return projectParents(retained, lines, version);
}
function projectParents(records, lines, version) {
    if (version <= 1) {
        for (let index = 0; index < records.length; index++)
            records[index].parentId = index ? records[index - 1].id : null;
        return records;
    }
    const sourceParents = new Map();
    for (const line of lines) {
        const id = sourceRecordId(line.value);
        if (id)
            sourceParents.set(id, sourceParentId(line.value) ?? null);
    }
    const retainedIds = new Set(records.map((record) => record.id));
    for (const record of records) {
        let parent = record.sourceParentId;
        const seen = new Set();
        while (parent && !retainedIds.has(parent) && !seen.has(parent)) {
            seen.add(parent);
            parent = sourceParents.get(parent) ?? null;
        }
        record.parentId = parent && retainedIds.has(parent) ? parent : null;
    }
    return records;
}
export function buildBranches(records) {
    const byId = new Map(records.map((record) => [record.id, record]));
    const children = new Map();
    for (const record of records) {
        if (!record.parentId || !byId.has(record.parentId))
            continue;
        const list = children.get(record.parentId) ?? [];
        list.push(record.id);
        children.set(record.parentId, list);
    }
    const leaves = records.filter((record) => !(children.get(record.id)?.length));
    return leaves.map((leaf) => {
        const branch = [];
        const seen = new Set();
        let current = leaf;
        while (current && !seen.has(current.id)) {
            branch.push(current);
            seen.add(current.id);
            current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        for (const record of branch)
            record.branchLeafId ??= leaf.id;
        return branch.reverse();
    });
}
export function parseJsonlBytes(bytes, options = {}) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const warnings = [];
    const lines = [];
    let start = 0;
    let completeOffset = 0;
    let index = 0;
    for (let newline = buffer.indexOf(0x0a, start); newline !== -1; newline = buffer.indexOf(0x0a, start)) {
        const end = newline + 1;
        const lineBytes = buffer.subarray(start, newline > start && buffer[newline - 1] === 0x0d ? newline - 1 : newline);
        if (lineBytes.length) {
            try {
                const value = JSON.parse(lineBytes.toString("utf8"));
                const object = asObject(value);
                if (!object)
                    throw new Error("record is not an object");
                lines.push({ value: object, range: { start, end }, hash: sha256(buffer.subarray(start, end)), index: index++ });
            }
            catch {
                warnings.push({ file: options.file, range: { start, end }, message: "Malformed complete JSONL record" });
            }
        }
        completeOffset = end;
        start = end;
    }
    const headerLine = lines.find((line) => line.value.type === "session");
    const metadataLine = headerLine ?? lines.find((line) => sessionHeaderFromRecord(line.value));
    const header = metadataLine ? sessionHeaderFromRecord(metadataLine.value) : undefined;
    if (!header)
        throw new Error(`${options.file ?? "JSONL"}: missing valid Pi session metadata`);
    const entryLines = headerLine ? lines.filter((line) => line !== headerLine) : lines;
    const records = normalizedFromRaw(entryLines, header, { ...options, cwd: options.cwd ?? header.cwd });
    const workerMarked = entryLines.some((line) => isWorkerEntry(line.value));
    const origin = header.origin === WORKER_ORIGIN || workerMarked || records.some((record) => record.origin === WORKER_ORIGIN)
        ? "cheatcodes-worker"
        : "user-session";
    const previous = Math.max(0, Math.min(options.previousCommittedOffset ?? 0, buffer.length));
    return {
        header, version: header.version, sessionId: header.id, records, branches: buildBranches(records), origin, warnings,
        completeOffset, completeSha256: sha256(buffer.subarray(0, completeOffset)),
        previousPrefixSha256: sha256(buffer.subarray(0, previous)),
    };
}
export async function parseJsonlFile(file, options = {}) {
    return parseJsonlBytes(await readFile(file), { ...options, file });
}

import { createAgentSession, DefaultResourceLoader, defineTool, getAgentDir, ModelRuntime, resolveCliModel, SessionManager, SettingsManager, } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import { QUALIFIER_PROMPT, validateQualification, } from "./qualify.js";
export const CuratedActionSchema = z.object({
    action: z.enum(["create", "update"]),
    targetEntryId: z.string().min(1).optional(),
    title: z.string().min(1),
    summary: z.string().min(1),
    body: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
    evidenceRefs: z.array(z.string().min(1)).min(1),
}).strict();
export const CuratorResponseSchema = z.object({ entries: z.array(CuratedActionSchema) }).strict();
export const CURATOR_PROMPT = `You curate durable project knowledge from a bounded evidence packet.
Return exactly one JSON object with an entries array. Do not return Markdown or commentary.
Each entry has action "create" or "update", title, summary, body, tags, and evidenceRefs.
Every entry states only current project truth. Do not describe history, addenda, or replaced guidance.
Accept only what a competent engineer could not reconstruct from the repository; prefer an empty entries array over low-signal entries.
For updates, set targetEntryId to the supplied update candidate ID and return the complete revised entry: the body must replace the candidate's body entirely rather than append.
Creates must omit targetEntryId.
Use only supplied evidence IDs. Never invent IDs, paths, timestamps, or provenance.
Return {"entries":[]} when the evidence does not justify durable knowledge.`;
export function validateCuratorResponse(value, packet) {
    const parsed = CuratorResponseSchema.parse(value);
    const evidenceIds = new Set(packet.evidence.map((item) => item.id));
    const updated = new Set();
    for (const entry of parsed.entries) {
        for (const reference of entry.evidenceRefs)
            if (!evidenceIds.has(reference))
                throw new Error(`Unknown evidence reference: ${reference}`);
        if (entry.action === "create" && entry.targetEntryId !== undefined)
            throw new Error("Create action must not include targetEntryId");
        if (entry.action === "update") {
            if (!entry.targetEntryId)
                throw new Error("Update action requires targetEntryId");
            if (!packet.updateCandidate || packet.updateCandidate.id !== entry.targetEntryId)
                throw new Error("Update target is not the packet update candidate");
            if (updated.has(entry.targetEntryId))
                throw new Error("A target may be updated only once per response");
            updated.add(entry.targetEntryId);
        }
    }
    return parsed;
}
function parseText(text, packet) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (error) {
        throw new Error(`Invalid JSON: ${error.message}`);
    }
    return validateCuratorResponse(value, packet);
}
function finalAssistantText(messages) {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant")
        throw new Error("Model produced no final assistant message");
    if (last.stopReason !== "stop")
        throw new Error(`Model stopped with ${last.stopReason ?? "missing stop reason"}${last.errorMessage ? `: ${last.errorMessage}` : ""}`);
    return (last.content ?? []).flatMap((block) => {
        const item = block;
        return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
    }).join("");
}
export class PiCurator {
    root;
    runtime;
    model;
    thinkingLevel;
    settings;
    loader;
    constructor(root, runtime, model, thinkingLevel, settings, loader) {
        this.root = root;
        this.runtime = runtime;
        this.model = model;
        this.thinkingLevel = thinkingLevel;
        this.settings = settings;
        this.loader = loader;
    }
    static async create(options) {
        const runtime = options.modelRuntime ?? await ModelRuntime.create({ modelsPath: options.modelsPath });
        const resolved = resolveCliModel({ cliModel: options.model, modelRuntime: runtime });
        if (resolved.error || !resolved.model)
            throw new Error(resolved.error ?? `Model not found: ${options.model}`);
        if (resolved.warning)
            throw new Error(resolved.warning);
        const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
        const loader = new DefaultResourceLoader({
            cwd: options.projectRoot,
            agentDir: getAgentDir(),
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            systemPrompt: CURATOR_PROMPT,
            appendSystemPrompt: [],
            settingsManager: settings,
        });
        await loader.reload();
        return new PiCurator(options.projectRoot, runtime, resolved.model, resolved.thinkingLevel ?? "medium", settings, loader);
    }
    async curate(packet) {
        let validationError = "";
        for (let attempt = 0; attempt < 2; attempt++) {
            const { session, modelFallbackMessage } = await createAgentSession({
                cwd: this.root,
                model: this.model,
                thinkingLevel: this.thinkingLevel,
                noTools: "all",
                sessionManager: SessionManager.inMemory(this.root),
                resourceLoader: this.loader,
                modelRuntime: this.runtime,
                settingsManager: this.settings,
            });
            try {
                if (modelFallbackMessage)
                    throw new Error(modelFallbackMessage);
                const start = session.messages.length;
                const prompt = attempt === 0
                    ? JSON.stringify(packet)
                    : `${JSON.stringify(packet)}\n\nYour prior output failed validation: ${validationError}. Return corrected JSON only.`;
                await session.prompt(prompt);
                const text = finalAssistantText(session.messages.slice(start));
                try {
                    return { response: parseText(text, packet), schemaInvalid: false };
                }
                catch (error) {
                    validationError = error.message;
                }
            }
            finally {
                session.dispose();
            }
        }
        return { schemaInvalid: true, warning: validationError };
    }
}
export function normalizeCuratorOutcome(value, packet) {
    if ("schemaInvalid" in value) {
        if (value.response)
            return { ...value, response: validateCuratorResponse(value.response, packet) };
        return value;
    }
    return { response: validateCuratorResponse(value, packet), schemaInvalid: false };
}
const GATE_SCHEMA = Type.Union([Type.Literal("pass"), Type.Literal("fail")]);
const QUALIFICATION_PARAMS = Type.Object({
    entries: Type.Array(Type.Object({
        candidateId: Type.String({ minLength: 1 }),
        verdict: Type.Union([Type.Literal("accept"), Type.Literal("reject"), Type.Literal("needs-review")]),
        kind: Type.Optional(Type.Union([Type.Literal("gotcha"), Type.Literal("decision"), Type.Literal("procedure"), Type.Literal("invariant")])),
        action: Type.Optional(Type.Union([Type.Literal("create"), Type.Literal("update")])),
        targetEntryId: Type.Optional(Type.String({ minLength: 1 })),
        gateResults: Type.Object({
            settled: GATE_SCHEMA,
            projectSpecific: GATE_SCHEMA,
            durable: GATE_SCHEMA,
            current: GATE_SCHEMA,
            nonInferable: GATE_SCHEMA,
            actionable: GATE_SCHEMA,
            entailed: GATE_SCHEMA,
            nonDuplicate: GATE_SCHEMA,
            nonContradictory: GATE_SCHEMA,
        }, { additionalProperties: false }),
        claims: Type.Array(Type.Object({ text: Type.String({ minLength: 1 }), evidenceRefs: Type.Array(Type.String({ minLength: 1 })) }, { additionalProperties: false })),
        rejectionReasons: Type.Array(Type.String({ minLength: 1 })),
        unresolvedQuestions: Type.Array(Type.String({ minLength: 1 })),
        proposedEntry: Type.Optional(Type.Object({
            title: Type.String({ minLength: 1 }),
            summary: Type.String({ minLength: 1 }),
            body: Type.String({ minLength: 1 }),
            tags: Type.Array(Type.String({ minLength: 1 })),
        }, { additionalProperties: false })),
    }, { additionalProperties: false })),
}, { additionalProperties: false });
function submitQualificationTool(packet, capture) {
    return defineTool({
        name: "submit_qualification",
        label: "Submit qualification",
        description: "Submit the final qualification verdict for the reviewed evidence packet. Required as your last action.",
        parameters: QUALIFICATION_PARAMS,
        execute: async (_toolCallId, params) => {
            try {
                const response = validateQualification(params, packet);
                capture.value = response;
                return { content: [{ type: "text", text: "Qualification recorded." }], details: { packetId: packet.id }, terminate: true };
            }
            catch (error) {
                capture.error = error.message;
                throw error;
            }
        },
    });
}
function finalUsage(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message?.role === "assistant" && message.usage) {
            return { inputTokens: message.usage.input ?? 0, outputTokens: message.usage.output ?? 0 };
        }
    }
    return undefined;
}
export class PiQualifier {
    root;
    runtime;
    model;
    thinkingLevel;
    settings;
    loader;
    constructor(root, runtime, model, thinkingLevel, settings, loader) {
        this.root = root;
        this.runtime = runtime;
        this.model = model;
        this.thinkingLevel = thinkingLevel;
        this.settings = settings;
        this.loader = loader;
    }
    static async create(options) {
        const runtime = options.modelRuntime ?? await ModelRuntime.create({ modelsPath: options.modelsPath });
        const resolved = resolveCliModel({ cliModel: options.model, modelRuntime: runtime });
        if (resolved.error || !resolved.model)
            throw new Error(resolved.error ?? `Model not found: ${options.model}`);
        if (resolved.warning)
            throw new Error(resolved.warning);
        const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
        const loader = new DefaultResourceLoader({
            cwd: options.projectRoot,
            agentDir: getAgentDir(),
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            systemPrompt: QUALIFIER_PROMPT,
            appendSystemPrompt: [],
            settingsManager: settings,
        });
        await loader.reload();
        return new PiQualifier(options.projectRoot, runtime, resolved.model, resolved.thinkingLevel ?? "medium", settings, loader);
    }
    async qualify(packet) {
        const startedAt = Date.now();
        let warning = "";
        let schemaRetries = 0;
        let usage;
        for (let attempt = 0; attempt < 2; attempt++) {
            const capture = {};
            const { session, modelFallbackMessage } = await createAgentSession({
                cwd: this.root,
                model: this.model,
                thinkingLevel: this.thinkingLevel,
                sessionManager: SessionManager.inMemory(this.root),
                resourceLoader: this.loader,
                modelRuntime: this.runtime,
                settingsManager: this.settings,
                customTools: [submitQualificationTool(packet, capture)],
            });
            try {
                if (modelFallbackMessage)
                    throw new Error(modelFallbackMessage);
                await session.prompt(JSON.stringify(packet));
                usage = finalUsage(session.messages) ?? usage;
                if (capture.value !== undefined) {
                    const response = validateQualification(capture.value, packet);
                    return { response, schemaInvalid: false, schemaRetries, latencyMs: Date.now() - startedAt, usage };
                }
                warning = capture.error ?? "model finished without calling submit_qualification";
            }
            catch (error) {
                warning = error.message;
            }
            finally {
                session.dispose();
            }
            schemaRetries = attempt + 1;
        }
        return { schemaInvalid: true, warning, schemaRetries, latencyMs: Date.now() - startedAt, usage };
    }
}

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { HarvestPacket } from "./harvest.js";

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
export type CuratedEntry = z.infer<typeof CuratedActionSchema>;
export type CuratorResponse = z.infer<typeof CuratorResponseSchema>;

export interface CuratorOutcome { response?: CuratorResponse; schemaInvalid: boolean; warning?: string }
export interface Curator { curate(packet: HarvestPacket): Promise<CuratorOutcome | CuratorResponse> }

export const CURATOR_PROMPT = `You curate durable project knowledge from a bounded evidence packet.
Return exactly one JSON object with an entries array. Do not return Markdown or commentary.
Each entry has action "create" or "update", title, summary, body, tags, and evidenceRefs.
Every entry states only current project truth. Do not describe history, addenda, or replaced guidance.
For updates, set targetEntryId to the supplied update candidate ID and return the complete revised entry: the body must replace the candidate's body entirely rather than append.
Creates must omit targetEntryId.
Use only supplied evidence IDs. Never invent IDs, paths, timestamps, or provenance.
Return {"entries":[]} when the evidence does not justify durable knowledge.`;

export function validateCuratorResponse(value: unknown, packet: HarvestPacket): CuratorResponse {
  const parsed = CuratorResponseSchema.parse(value);
  const evidenceIds = new Set(packet.evidence.map((item) => item.id));
  const updated = new Set<string>();
  for (const entry of parsed.entries) {
    for (const reference of entry.evidenceRefs) if (!evidenceIds.has(reference)) throw new Error(`Unknown evidence reference: ${reference}`);
    if (entry.action === "create" && entry.targetEntryId !== undefined) throw new Error("Create action must not include targetEntryId");
    if (entry.action === "update") {
      if (!entry.targetEntryId) throw new Error("Update action requires targetEntryId");
      if (!packet.updateCandidate || packet.updateCandidate.id !== entry.targetEntryId) throw new Error("Update target is not the packet update candidate");
      if (updated.has(entry.targetEntryId)) throw new Error("A target may be updated only once per response");
      updated.add(entry.targetEntryId);
    }
  }
  return parsed;
}

function parseText(text: string, packet: HarvestPacket): CuratorResponse {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`Invalid JSON: ${(error as Error).message}`); }
  return validateCuratorResponse(value, packet);
}

function finalAssistantText(messages: readonly unknown[]): string {
  const last = messages[messages.length - 1] as { role?: string; stopReason?: string; content?: unknown[]; errorMessage?: string } | undefined;
  if (!last || last.role !== "assistant") throw new Error("Model produced no final assistant message");
  if (last.stopReason !== "stop") throw new Error(`Model stopped with ${last.stopReason ?? "missing stop reason"}${last.errorMessage ? `: ${last.errorMessage}` : ""}`);
  return (last.content ?? []).flatMap((block) => {
    const item = block as { type?: string; text?: string };
    return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("");
}

export interface PiCuratorOptions { projectRoot: string; model: string; modelRuntime?: ModelRuntime; modelsPath?: string }

export class PiCurator implements Curator {
  private constructor(
    private readonly root: string,
    private readonly runtime: ModelRuntime,
    private readonly model: NonNullable<ReturnType<typeof resolveCliModel>["model"]>,
    private readonly thinkingLevel: NonNullable<ReturnType<typeof resolveCliModel>["thinkingLevel"]> | "medium",
    private readonly settings: SettingsManager,
    private readonly loader: DefaultResourceLoader,
  ) {}

  static async create(options: PiCuratorOptions): Promise<PiCurator> {
    const runtime = options.modelRuntime ?? await ModelRuntime.create({ modelsPath: options.modelsPath });
    const resolved = resolveCliModel({ cliModel: options.model, modelRuntime: runtime });
    if (resolved.error || !resolved.model) throw new Error(resolved.error ?? `Model not found: ${options.model}`);
    if (resolved.warning) throw new Error(resolved.warning);
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

  async curate(packet: HarvestPacket): Promise<CuratorOutcome> {
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
        if (modelFallbackMessage) throw new Error(modelFallbackMessage);
        const start = session.messages.length;
        const prompt = attempt === 0
          ? JSON.stringify(packet)
          : `${JSON.stringify(packet)}\n\nYour prior output failed validation: ${validationError}. Return corrected JSON only.`;
        await session.prompt(prompt);
        const text = finalAssistantText(session.messages.slice(start));
        try { return { response: parseText(text, packet), schemaInvalid: false }; }
        catch (error) { validationError = (error as Error).message; }
      } finally { session.dispose(); }
    }
    return { schemaInvalid: true, warning: validationError };
  }
}

export function normalizeCuratorOutcome(value: CuratorOutcome | CuratorResponse, packet: HarvestPacket): CuratorOutcome {
  if ("schemaInvalid" in value) {
    if (value.response) return { ...value, response: validateCuratorResponse(value.response, packet) };
    return value;
  }
  return { response: validateCuratorResponse(value, packet), schemaInvalid: false };
}

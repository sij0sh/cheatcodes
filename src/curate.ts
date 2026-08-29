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

const common = {
  action: z.enum(["create", "update"]),
  targetConceptId: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1)).min(1),
};
const DecisionSchema = z.object({ ...common, type: z.literal("Decision"), content: z.object({ answer: z.string().min(1), rationale: z.string().min(1), rejectedAlternative: z.string().min(1).optional() }).strict() }).strict();
const GotchaSchema = z.object({ ...common, type: z.literal("Gotcha"), content: z.object({ symptom: z.string().min(1), cause: z.string().min(1), fix: z.string().min(1), validation: z.string().min(1).optional() }).strict() }).strict();
const RunbookSchema = z.object({ ...common, type: z.literal("Runbook"), content: z.object({ purpose: z.string().min(1), steps: z.array(z.string().min(1)).min(1), validation: z.string().min(1).optional() }).strict() }).strict();
export const CuratorResponseSchema = z.object({ concepts: z.array(z.discriminatedUnion("type", [DecisionSchema, GotchaSchema, RunbookSchema])) }).strict();
export type CuratedConcept = z.infer<typeof DecisionSchema> | z.infer<typeof GotchaSchema> | z.infer<typeof RunbookSchema>;
export type CuratorResponse = z.infer<typeof CuratorResponseSchema>;

export interface CuratorOutcome { response?: CuratorResponse; schemaInvalid: boolean; warning?: string }
export interface Curator { curate(packet: HarvestPacket): Promise<CuratorOutcome | CuratorResponse> }

export const CURATOR_PROMPT = `You curate durable project knowledge from a bounded evidence packet.
Return exactly one JSON object with a concepts array. Do not return Markdown or commentary.
Each concept action is create or update and has type Decision, Gotcha, or Runbook, title, description, tags, evidenceRefs, and type-specific content.
Updates must name targetConceptId and may target only the supplied update candidate. Creates must omit targetConceptId.
Use only supplied evidence IDs. Never invent IDs, paths, timestamps, status, verification, or provenance.
Return {"concepts":[]} when the evidence does not justify durable knowledge.`;

export function validateCuratorResponse(value: unknown, packet: HarvestPacket): CuratorResponse {
  const parsed = CuratorResponseSchema.parse(value);
  const evidenceIds = new Set(packet.evidence.map((item) => item.id));
  const updated = new Set<string>();
  for (const concept of parsed.concepts) {
    for (const reference of concept.evidenceRefs) if (!evidenceIds.has(reference)) throw new Error(`Unknown evidence reference: ${reference}`);
    if (concept.action === "create" && concept.targetConceptId !== undefined) throw new Error("Create action must not include targetConceptId");
    if (concept.action === "update") {
      if (!concept.targetConceptId) throw new Error("Update action requires targetConceptId");
      if (!packet.updateCandidate || packet.updateCandidate.id !== concept.targetConceptId) throw new Error("Update target is not the packet update candidate");
      if (packet.updateCandidate.type !== concept.type) throw new Error("Update type does not match target type");
      if (updated.has(concept.targetConceptId)) throw new Error("A target may be updated only once per response");
      updated.add(concept.targetConceptId);
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

export interface PiCuratorOptions { projectRoot: string; model: string; modelRuntime?: ModelRuntime }

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
    const runtime = options.modelRuntime ?? await ModelRuntime.create();
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

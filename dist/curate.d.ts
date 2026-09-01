import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { HarvestPacket } from "./harvest.js";
import { type QualificationOutcome, type Qualifier } from "./qualify.js";
export declare const CuratedActionSchema: z.ZodObject<{
    action: z.ZodEnum<{
        create: "create";
        update: "update";
    }>;
    targetEntryId: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
    summary: z.ZodString;
    body: z.ZodString;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    evidenceRefs: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const CuratorResponseSchema: z.ZodObject<{
    entries: z.ZodArray<z.ZodObject<{
        action: z.ZodEnum<{
            create: "create";
            update: "update";
        }>;
        targetEntryId: z.ZodOptional<z.ZodString>;
        title: z.ZodString;
        summary: z.ZodString;
        body: z.ZodString;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        evidenceRefs: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type CuratedEntry = z.infer<typeof CuratedActionSchema>;
export type CuratorResponse = z.infer<typeof CuratorResponseSchema>;
export interface CuratorOutcome {
    response?: CuratorResponse;
    schemaInvalid: boolean;
    warning?: string;
}
export interface Curator {
    curate(packet: HarvestPacket): Promise<CuratorOutcome | CuratorResponse>;
}
export declare const CURATOR_PROMPT = "You curate durable project knowledge from a bounded evidence packet.\nReturn exactly one JSON object with an entries array. Do not return Markdown or commentary.\nEach entry has action \"create\" or \"update\", title, summary, body, tags, and evidenceRefs.\nEvery entry states only current project truth. Do not describe history, addenda, or replaced guidance.\nAccept only what a competent engineer could not reconstruct from the repository; prefer an empty entries array over low-signal entries.\nFor updates, set targetEntryId to the supplied update candidate ID and return the complete revised entry: the body must replace the candidate's body entirely rather than append.\nCreates must omit targetEntryId.\nUse only supplied evidence IDs. Never invent IDs, paths, timestamps, or provenance.\nReturn {\"entries\":[]} when the evidence does not justify durable knowledge.";
export declare function validateCuratorResponse(value: unknown, packet: HarvestPacket): CuratorResponse;
export interface PiCuratorOptions {
    projectRoot: string;
    model: string;
    modelRuntime?: ModelRuntime;
    modelsPath?: string;
}
export declare class PiCurator implements Curator {
    private readonly root;
    private readonly runtime;
    private readonly model;
    private readonly thinkingLevel;
    private readonly settings;
    private readonly loader;
    private constructor();
    static create(options: PiCuratorOptions): Promise<PiCurator>;
    curate(packet: HarvestPacket): Promise<CuratorOutcome>;
}
export declare function normalizeCuratorOutcome(value: CuratorOutcome | CuratorResponse, packet: HarvestPacket): CuratorOutcome;
export declare function finalUsage(messages: readonly unknown[]): {
    inputTokens: number;
    outputTokens: number;
} | undefined;
export interface PiQualifierOptions {
    projectRoot: string;
    model: string;
    modelRuntime?: ModelRuntime;
    modelsPath?: string;
}
export declare class PiQualifier implements Qualifier {
    private readonly root;
    private readonly runtime;
    private readonly model;
    private readonly thinkingLevel;
    private readonly settings;
    private readonly loader;
    private constructor();
    static create(options: PiQualifierOptions): Promise<PiQualifier>;
    qualify(packet: HarvestPacket): Promise<QualificationOutcome>;
}

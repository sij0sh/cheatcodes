import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function temporary(prefix = "cheatcodes-test-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export interface GlobalConfigOptions {
  dir?: string;
  model?: string;
  inputs?: string[];
  workerTimeoutMinutes?: number;
  knowledgeFile?: string;
  contextPointer?: boolean;
  projectAliases?: Record<string, string[]>;
}

export function globalConfigObject(options: GlobalConfigOptions = {}): Record<string, unknown> {
  return {
    version: 2,
    model: options.model ?? "fake/model",
    inputs: options.inputs ?? [],
    workerTimeoutMinutes: options.workerTimeoutMinutes ?? 10,
    ...(options.knowledgeFile !== undefined ? { knowledgeFile: options.knowledgeFile } : {}),
    ...(options.contextPointer !== undefined ? { contextPointer: options.contextPointer } : {}),
    projectAliases: options.projectAliases ?? {},
  };
}

export async function writeGlobalConfig(options: GlobalConfigOptions = {}): Promise<{ file: string; env: NodeJS.ProcessEnv }> {
  const dir = options.dir ?? await temporary("cheatcodes-config-");
  const file = path.join(dir, "config.json");
  await writeFile(file, JSON.stringify(globalConfigObject(options), null, 2));
  return { file, env: { CHEATCODES_CONFIG: file, CHEATCODES_STATE: path.join(dir, "state.json") } };
}

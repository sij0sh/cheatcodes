import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { globalConfigPath } from "./config.js";
import { atomicWrite } from "./state.js";

export const MODELS_FILE_NAME = "models.json";

// A minimal but fully valid registry: one OpenAI-compatible provider with a
// placeholder endpoint and an environment-backed key. Users replace the
// values; the shape is accepted by ModelRuntime as-is.
export const MODELS_SCAFFOLD = `${JSON.stringify({
  providers: {
    example: {
      baseUrl: "https://api.example.com/v1",
      api: "openai-completions",
      apiKey: "$EXAMPLE_API_KEY",
      models: [
        {
          id: "example-model",
          name: "Example Model",
          reasoning: false,
          contextWindow: 128000,
          maxTokens: 8192,
        },
      ],
    },
  },
}, null, 2)}\n`;

export function modelsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(globalConfigPath(env)), MODELS_FILE_NAME);
}

// Resolve explicitly from env so callers can sandbox PI_CODING_AGENT_DIR.
// getAgentDir() alone reads process.env at call time.
export function piModelsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const agentDir = env.PI_CODING_AGENT_DIR?.trim() || getAgentDir();
  return path.join(agentDir, MODELS_FILE_NAME);
}

// Seed the cheatcodes model registry once. An existing file is never
// rewritten. A Pi installation's registry is mirrored verbatim; without Pi
// a scaffold is written. Returns the file path for ModelRuntime.
export async function ensureModelsFile(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const target = modelsFilePath(env);
  try {
    await readFile(target);
    return target;
  } catch {
    // Absent or unreadable; seed below.
  }
  let contents: string | Buffer = MODELS_SCAFFOLD;
  try {
    contents = await readFile(piModelsFilePath(env));
  } catch {
    // No Pi registry; keep the scaffold.
  }
  await atomicWrite(target, contents);
  return target;
}

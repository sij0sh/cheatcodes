import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelRuntime, resolveCliModel } from "@earendil-works/pi-coding-agent";
import { ensureModelsFile, MODELS_SCAFFOLD, modelsFilePath, piModelsFilePath } from "../src/models.js";

async function sandbox(): Promise<{ root: string; agentDir: string; env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cheatcodes-models-"));
  const configDir = path.join(root, "config");
  const agentDir = path.join(root, "pi-agent");
  const env: NodeJS.ProcessEnv = {
    CHEATCODES_CONFIG: path.join(configDir, "config.json"),
    CHEATCODES_STATE: path.join(configDir, "state.json"),
    PI_CODING_AGENT_DIR: agentDir,
  };
  return { root, agentDir, env };
}

test("a missing registry is scaffolded", async () => {
  const { root, env } = await sandbox();
  try {
    const target = await ensureModelsFile(env);
    assert.equal(target, modelsFilePath(env));
    const parsed = JSON.parse(await readFile(target, "utf8")) as { providers: Record<string, { models: Array<{ id: string }> }> };
    assert.equal(parsed.providers.example.models[0]!.id, "example-model");
    assert.equal(await readFile(target, "utf8"), MODELS_SCAFFOLD);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a Pi registry is mirrored verbatim", async () => {
  const { root, agentDir, env } = await sandbox();
  try {
    await mkdir(agentDir, { recursive: true });
    const piContent = JSON.stringify({ providers: { mine: { baseUrl: "https://x/v1", api: "openai-completions", models: [{ id: "m1" }] } } });
    await writeFile(piModelsFilePath(env), piContent);
    const target = await ensureModelsFile(env);
    assert.equal(await readFile(target, "utf8"), piContent);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an existing registry is never overwritten", async () => {
  const { root, agentDir, env } = await sandbox();
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(piModelsFilePath(env), '{"providers":{"pi":{}}}');
    const target = modelsFilePath(env);
    const mine = '{"providers":{"mine":{}}}';
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, mine);
    await ensureModelsFile(env);
    assert.equal(await readFile(target, "utf8"), mine);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the scaffold resolves in ModelRuntime", async () => {
  const { root, env } = await sandbox();
  try {
    const target = await ensureModelsFile(env);
    const runtime = await ModelRuntime.create({ modelsPath: target });
    assert.ok(runtime.getModel("example", "example-model"));
    const resolved = resolveCliModel({ cliModel: "example/example-model", modelRuntime: runtime });
    assert.equal(resolved.error, undefined);
    assert.ok(resolved.model);
  } finally { await rm(root, { recursive: true, force: true }); }
});

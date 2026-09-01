import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import cheatcodesExtension, { autorunEnabled, defaultResolveCli, launchAutorun, toolsEnabled, type AutorunDeps } from "../src/workflow/extension.js";
import type { GlobalConfig } from "../src/config.js";

interface SpawnCall {
	cmd: string;
	args: string[];
	opts: Record<string, unknown>;
}

interface Captured {
	spawn?: (event: unknown, ctx: unknown) => unknown;
	spawnCalls: SpawnCall[];
	lastChild?: EventEmitter & { unrefCalled?: boolean };
}

type AnyCtx = Record<string, unknown>;


function fakeSpawn(captured: Captured, impl?: () => never): AutorunDeps["spawn"] {
	const spawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
		captured.spawnCalls.push({ cmd, args, opts });
		if (impl) impl();
		const child = new EventEmitter() as EventEmitter & { unrefCalled?: boolean; unref: () => void };
		child.unref = () => {
			child.unrefCalled = true;
			return child;
		};
		captured.lastChild = child;
		return child;
	}) as AutorunDeps["spawn"];
	return spawn;
}

function fakeCtx(overrides: AnyCtx = {}): AnyCtx {
	return {
		cwd: "/home/u/Projects/demo",
		isProjectTrusted: () => true,
		sessionManager: { getSessionFile: () => "/home/u/.pi/agent/sessions/demo/main.jsonl" },
		model: { provider: "prov", id: "m1" },
		thinkingLevel: "high",
		...overrides,
	};
}

function configWith(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
	return { version: 2, model: "prov/m1", inputs: [], workerTimeoutMinutes: 10, projectAliases: {}, ...overrides };
}

async function launch(captured: Captured, event: AnyCtx = { reason: "startup" }, ctx?: AnyCtx, loadConfig?: AutorunDeps["loadConfig"]): Promise<void> {
	launchAutorun(
		{ on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { assert.equal(name, "session_start"); captured.spawn = handler; } } as never,
		{ spawn: fakeSpawn(captured), resolveCli: () => "/cli/dist/cli.js", loadConfig: loadConfig ?? (async () => undefined) },
	);
	await captured.spawn!(event, ctx ?? fakeCtx());
}

test("startup spawns ensure detached and unref'd", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured);

	assert.equal(captured.spawnCalls.length, 1);
	const call = captured.spawnCalls[0]!;
	assert.equal(call.cmd, process.execPath);
	assert.deepEqual(call.args, ["/cli/dist/cli.js", "ensure", "--timeout", "120"]);
	assert.equal(call.opts.cwd, "/home/u/Projects/demo");
	assert.equal(call.opts.detached, true);
	assert.equal(call.opts.stdio, "ignore");
	assert.equal(call.opts.shell, false);
	assert.ok(captured.lastChild?.unrefCalled);
});

test("ensure timeout passes through from the environment", async () => {
	const previous = process.env.CHEATCODES_ENSURE_TIMEOUT;
	process.env.CHEATCODES_ENSURE_TIMEOUT = "45";
	const captured: Captured = { spawnCalls: [] };
	try {
		await launch(captured);
		assert.deepEqual(captured.spawnCalls[0]!.args, ["/cli/dist/cli.js", "ensure", "--timeout", "45"]);
	} finally {
		if (previous === undefined) delete process.env.CHEATCODES_ENSURE_TIMEOUT;
		else process.env.CHEATCODES_ENSURE_TIMEOUT = previous;
	}
});

test("CHEATCODES_ENSURE=0 disables the autorun", async () => {
	const previous = process.env.CHEATCODES_ENSURE;
	process.env.CHEATCODES_ENSURE = "0";
	const captured: Captured = { spawnCalls: [] };
	try {
		await launch(captured);
		assert.equal(captured.spawnCalls.length, 0);
	} finally {
		if (previous === undefined) delete process.env.CHEATCODES_ENSURE;
		else process.env.CHEATCODES_ENSURE = previous;
	}
});

test("copies launcher hints into child env", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured, { reason: "startup", previousSessionFile: "/prev.jsonl" });

	const env = captured.spawnCalls[0]!.opts.env as Record<string, string>;
	assert.equal(env.CHEATCODES_PI_SESSION_FILE, "/home/u/.pi/agent/sessions/demo/main.jsonl");
	assert.equal(env.CHEATCODES_PI_PREVIOUS_SESSION_FILE, "/prev.jsonl");
	assert.equal(env.CHEATCODES_PI_MODEL, "prov/m1");
	assert.equal(env.CHEATCODES_PI_THINKING, "high");
});

test("preserves inherited environment", async () => {
	process.env.CHEATCODES_TEST_MARKER = "present";
	const captured: Captured = { spawnCalls: [] };
	try {
		await launch(captured);
		const env = captured.spawnCalls[0]!.opts.env as Record<string, string>;
		assert.equal(env.CHEATCODES_TEST_MARKER, "present");
	} finally {
		delete process.env.CHEATCODES_TEST_MARKER;
	}
});

test("skips reload", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured, { reason: "reload" });
	assert.equal(captured.spawnCalls.length, 0);
});

test("skips untrusted projects", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured, { reason: "startup" }, fakeCtx({ isProjectTrusted: () => false }));
	assert.equal(captured.spawnCalls.length, 0);
});

test("autorun defaults to on without a config file", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured, { reason: "startup" }, undefined, async () => undefined);
	assert.equal(captured.spawnCalls.length, 1);
});

test("autorun: false in config skips the spawn", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured, { reason: "startup" }, undefined, async () => configWith({ autorun: false }));
	assert.equal(captured.spawnCalls.length, 0);
});

test("autorun: true in config spawns", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured, { reason: "startup" }, undefined, async () => configWith({ autorun: true }));
	assert.equal(captured.spawnCalls.length, 1);
});

test("autorun stays on when config validation fails", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured, { reason: "startup" }, undefined, async () => { throw new Error("invalid config"); });
	assert.equal(captured.spawnCalls.length, 1);
});

test("autorunEnabled reflects the config gate directly", async () => {
	assert.equal(await autorunEnabled(async () => configWith({ autorun: false })), false);
	assert.equal(await autorunEnabled(async () => configWith({ autorun: true })), true);
	assert.equal(await autorunEnabled(async () => configWith({})), true);
	assert.equal(await autorunEnabled(async () => undefined), true);
	assert.equal(await autorunEnabled(async () => { throw new Error("boom"); }), true);
});

test("ephemeral session spawns without session hint", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured, { reason: "startup" }, fakeCtx({ sessionManager: { getSessionFile: () => undefined } }));

	assert.equal(captured.spawnCalls.length, 1);
	const env = captured.spawnCalls[0]!.opts.env as Record<string, string>;
	assert.equal(env.CHEATCODES_PI_SESSION_FILE, undefined);
	assert.equal(env.CHEATCODES_PI_PREVIOUS_SESSION_FILE, undefined);
});

test("missing model and thinking level spawn without hints", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured, { reason: "startup" }, fakeCtx({ model: undefined, thinkingLevel: undefined }));

	assert.equal(captured.spawnCalls.length, 1);
	const env = captured.spawnCalls[0]!.opts.env as Record<string, string>;
	assert.equal(env.CHEATCODES_PI_MODEL, undefined);
	assert.equal(env.CHEATCODES_PI_THINKING, undefined);
});

test("missing CLI resolution spawns nothing without throwing", async () => {
	const captured: Captured = { spawnCalls: [] };
	launchAutorun(
		{ on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { assert.equal(name, "session_start"); captured.spawn = handler; } } as never,
		{
			spawn: fakeSpawn(captured),
			resolveCli: () => { throw new Error("not installed"); },
			loadConfig: async () => undefined,
		},
	);
	await assert.doesNotReject(() => captured.spawn!({ reason: "startup" }, fakeCtx()));
	assert.equal(captured.spawnCalls.length, 0);
});

test("immediate spawn failure does not throw", async () => {
	const captured: Captured = { spawnCalls: [] };
	launchAutorun(
		{ on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { captured.spawn = handler; } } as never,
		{
			spawn: fakeSpawn(captured, () => { throw new Error("EACCES"); }),
			resolveCli: () => "/cli/dist/cli.js",
			loadConfig: async () => undefined,
		},
	);
	await assert.doesNotReject(() => captured.spawn!({ reason: "startup" }, fakeCtx()));
});

test("async child error event does not crash", async () => {
	const captured: Captured = { spawnCalls: [] };
	await launch(captured);
	assert.doesNotThrow(() => captured.lastChild!.emit("error", new Error("ENOENT")));
});

function fakePi(tools: unknown[]) {
	let handlers = 0;
	return {
		pi: {
			registerTool: (tool: unknown) => { tools.push(tool); },
			on: (name: string, handler: unknown) => { assert.equal(name, "session_start"); assert.ok(handler); handlers++; },
		},
		assertHandlers: (expected: number) => assert.equal(handlers, expected),
	};
}

function configLoad(config: GlobalConfig | undefined | Error): AutorunDeps["loadConfig"] {
	return async () => {
		if (config instanceof Error) throw config;
		return config;
	};
}

test("default export registers tools and the autorun handler", async () => {
	const tools: unknown[] = [];
	const { pi, assertHandlers } = fakePi(tools);
	await assert.doesNotReject(() => cheatcodesExtension(pi as never, { loadConfig: configLoad(undefined) }));
	assert.ok(tools.length > 0);
	assert.equal(tools[0] && (tools[0] as { name?: string }).name, "search_knowledge");
	assertHandlers(1);
});

test("tools: false in config registers no tools but keeps autorun", async () => {
	const tools: unknown[] = [];
	const { pi, assertHandlers } = fakePi(tools);
	await cheatcodesExtension(pi as never, { loadConfig: configLoad(configWith({ tools: false })) });
	assert.equal(tools.length, 0);
	assertHandlers(1);
});

test("deps tools: true overrides config and registers the tools", async () => {
	const tools: unknown[] = [];
	const { pi, assertHandlers } = fakePi(tools);
	await cheatcodesExtension(pi as never, { tools: true, loadConfig: configLoad(configWith({ tools: false })) });
	assert.ok(tools.length > 0);
	assertHandlers(1);
});

test("tools stay on when config validation fails", async () => {
	const tools: unknown[] = [];
	const { pi, assertHandlers } = fakePi(tools);
	await cheatcodesExtension(pi as never, { loadConfig: configLoad(new Error("invalid config")) });
	assert.ok(tools.length > 0);
	assertHandlers(1);
});

test("toolsEnabled reflects the config gate directly", async () => {
	assert.equal(await toolsEnabled(configLoad(configWith({ tools: false }))), false);
	assert.equal(await toolsEnabled(configLoad(configWith({ tools: true }))), true);
	assert.equal(await toolsEnabled(configLoad(configWith({}))), true);
	assert.equal(await toolsEnabled(configLoad(undefined)), true);
	assert.equal(await toolsEnabled(configLoad(new Error("boom"))), true);
});

test("defaultResolveCli resolves the bundled CLI entry", () => {
	assert.match(defaultResolveCli(), /cli\.js$/);
});

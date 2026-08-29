# Cheatcodes standalone and Pi fire-and-forget alignment plan

> **STATUS (2026-02-27): IMPLEMENTED.** Standalone (global config, worker, CLI auto, migration, packaging) and Pi extension (sync fire-and-forget spawn) are shipped. cheat-codes: 20 tests pass + 1 opt-in live skip; build + pack dry-run OK. Extension: 10 tests pass, typecheck OK, CLI resolves via `cheatcodes/cli` export. Live repo migrated and verified with `status`.

## Goal

Keep the product boundary strict.

- `cheatcodes` remains a standalone CLI and owns configuration, setup, migration, scanning, curation, locking, state, logs, and publishing.
- `pi-cheatcodes` remains a one-way launch shim and owns only Pi lifecycle adaptation.
- Pi startup never waits for cheatcodes setup, scanning, or model work.
- A trusted Git repository is set up and processed automatically by default.
- User settings live in one global config instead of every repository.

## Current findings

### Pi extension

`/home/joshsimon/Projects/pi-extensions/pi-cheatcodes/index.ts` currently blocks Pi startup.

- Pi awaits every `session_start` handler.
- The handler awaits `bootstrap()` and `refresh()`.
- `bootstrap()` awaits `pi.exec()` for up to 30 seconds.
- `refresh()` recursively scans session directories and reads JSONL headers serially.
- `pi.exec()` is a join operation with piped output and no detached mode.
- The extension initializes missing projects but does not run harvesting on startup.
- The extension duplicates CLI scanner and state logic for its widget.
- The extension hardcodes a development checkout, the `tsx` loader, and `~/.pi/agent/sessions`.
- The hardcoded session path ignores `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `--session-dir`, and ephemeral sessions.
- The project check fails when Pi starts in a repository subdirectory.
- Automatic writes do not check `ctx.isProjectTrusted()`.
- The active Pi thinking level is discarded during setup.

### Standalone CLI

The standalone boundary is already sound inside the curation pipeline.

- `src/curate.ts` embeds the Pi SDK in an isolated in-memory session.
- It disables extensions, tools, skills, prompt templates, themes, context files, compaction, and retry.
- The standalone process does not need to communicate with the parent Pi session.

The current configuration and CLI need cleanup.

- `src/config.ts` stores `model`, `inputs`, and `projectRoots` in each repository's `.cheatcodes/config.json`.
- `cheatcodes init` requires `--model` and one or more `--input` flags.
- The CLI silently ignores unknown and trailing options.
- Project discovery depends on the legacy config file instead of a project marker.
- `init` can create a nested `.cheatcodes` directory when run from a repository subdirectory.
- Config, state, canonical concepts, and generated knowledge are all ignored by the current `.gitignore` rule.
- `init` adds an `AGENTS.md` pointer before guaranteeing that `.cheatcodes/knowledge/index.md` exists.
- `status` counts stale state cursors instead of currently discovered files.
- Removed inputs leave obsolete absolute cursors indefinitely.
- The package executable uses `dist/`, but package scripts do not guarantee a fresh build before packing.
- The package has no `files` allowlist, so development plans, tests, and helper artifacts can enter a tarball.
- Only two required automated tests currently cover the implementation.

### Existing migration artifacts

The implementation still carries pre-release assumptions.

- `.pi-files/concept.md` describes the superseded `.curator/` design.
- `.pi-files/diagnose.ts` and `.pi-files/preview-packets.ts` depend on the old config shape.
- `.pi-files/tsconfig.ext.json` and the extension's `.pi-files/tsconfig.json` contain absolute local paths.
- The Pi extension package describes a widget and slash command that should no longer define the integration.
- The standalone package is version `0.1.0`, and generated concept metadata hardcodes the same version string.

## Target architecture

```text
Pi session_start
  -> apply synchronous event and trust gates
  -> spawn the built cheatcodes CLI in detached mode
  -> unref the child
  -> return immediately

Detached `cheatcodes auto` worker
  -> load or migrate global config
  -> discover the repository root
  -> initialize the repository when policy permits
  -> coalesce with an existing worker
  -> process eligible session files
  -> publish knowledge
  -> write file-based status and logs
  -> exit
```

The extension does not wait for any worker result.

The extension does not scan JSONL, read cheatcodes state, render a widget, parse worker output, or report worker completion to Pi.

## Configuration design

### Global config

Use this location order.

1. `CHEATCODES_CONFIG` for tests and explicit deployment overrides.
2. `$XDG_CONFIG_HOME/cheatcodes/config.json`.
3. `~/.config/cheatcodes/config.json`.

Use a versioned minimal schema.

```json
{
  "version": 1,
  "model": "provider/model:thinking",
  "inputs": [],
  "automation": {
    "enabled": true,
    "setupMissingProjects": true
  },
  "workerTimeoutMinutes": 10,
  "projectAliases": {}
}
```

Rules:

- `model` is the only curator model for the machine.
- `inputs` contains user-managed global session files or directories.
- Relative inputs resolve from the global config directory.
- `~` expands to the current home directory.
- Pi-provided session directories are invocation hints and are merged in memory for that run.
- `automation.enabled` controls the machine-facing `auto` command.
- `automation.setupMissingProjects` defaults to `true`.
- `projectAliases` maps a persistent project ID to old or alternate checkout roots.
- Unknown keys fail validation with their full config path.
- The global file is written atomically with mode `0600`.
- The global config remains owned and validated by the standalone CLI.
- The Pi extension never parses or rewrites this schema.

For a brand-new Pi-driven installation, the extension passes the active model and thinking level as a one-way bootstrap hint. The worker may use that hint only when creating a missing global config. An existing global model always wins.

### Per-repository files

Keep only repository identity, durable knowledge, and machine-local producer state in the repository.

```text
.cheatcodes/
|-- project.json
|-- curated/
|   `-- concepts/
|-- knowledge/
|   |-- index.md
|   `-- concepts/
`-- local/
    |-- state.json
    |-- operations/
    |-- run.lock
    |-- last-run.json
    `-- worker.jsonl
```

`project.json` contains only durable project identity.

```json
{
  "version": 1,
  "projectId": "github.com/owner/repository"
}
```

Rules:

- `project.json`, `curated/`, and `knowledge/` are eligible for source control.
- `local/` is machine-local and ignored.
- The repository root itself is always an eligible project root.
- Additional checkout aliases come from the global config.
- Setup publishes an empty knowledge bundle before adding or validating the context pointer.

## CLI design

Keep the user-facing commands optionless for normal use.

```text
cheatcodes init
cheatcodes run
cheatcodes publish
cheatcodes status
```

Add one machine-facing command for launchers.

```text
cheatcodes auto
```

Behavior:

- `init` finds the Git top level and creates project files there.
- `init` requires a valid global config and never accepts model, input, or project-root flags.
- `run`, `publish`, and `status` walk upward to find `.cheatcodes/project.json`.
- `auto` finds the Git top level from its working directory.
- `auto` exits cleanly outside a Git repository.
- `auto` exits cleanly when automation is disabled.
- `auto` initializes a missing project when `setupMissingProjects` is true.
- `auto` runs immediately after successful setup.
- `auto` treats an active project lock as a successful coalesced launch.
- Unknown commands, options, and trailing arguments fail with exit code 2.
- `status` reports current discovered inputs, concept counts, last worker result, and migration warnings.
- `publish` remains available because deterministic bundle recovery is a standalone guarantee.

Keep programmatic dependency injection for tests. Do not expose test-only root or config overrides as normal CLI flags.

## Pi extension design

### Lifecycle behavior

Use one synchronous `session_start` handler.

- Skip `event.reason === "reload"`.
- Skip untrusted projects with `ctx.isProjectTrusted()`.
- Snapshot only plain values from `ctx`.
- Launch on `startup`, `new`, `resume`, and `fork`.
- Return immediately after spawn acceptance.
- Do not retain `ctx`, `pi`, or `SessionManager` objects in callbacks.

Pass these non-secret one-way hints through the child environment.

- Launcher name and protocol version.
- `ctx.cwd`.
- `ctx.sessionManager.getSessionFile()` when persisted.
- `event.previousSessionFile` when available.
- Active `provider/model` and `ctx.thinkingLevel` as first-config bootstrap hints.

The worker should use the parent directories of actual session files as temporary inputs. This avoids reconstructing Pi's session path and avoids scanning every global session directory on each launch.

### Process launch

Resolve the compiled CLI from the installed `cheatcodes` package export.

Use this process shape.

```ts
const child = spawn(process.execPath, [cliPath, "auto"], {
  cwd,
  detached: true,
  stdio: "ignore",
  shell: false,
  env,
});
child.unref();
```

Requirements:

- Do not use `pi.exec()`.
- Do not run TypeScript through `tsx`.
- Do not resolve a personal checkout path.
- Do not pipe stdout or stderr.
- Do not attach a completion callback.
- Catch only immediate spawn setup failures.
- Write immediate launcher failures to stderr or a small global launcher log.
- Let the standalone worker own all later errors and timeouts.

### Remove interactive integration behavior

Delete these extension responsibilities.

- The unread-session widget.
- Recursive JSONL discovery.
- State parsing.
- Bootstrap result notifications.
- Run result notifications.
- The foreground `/cheatcodes` command.
- The in-memory `running` flag.

Users retain manual control through the standalone CLI. This keeps the extension fully hands-off.

## Worker observability and safety

A detached worker cannot depend on Pi for status or deadlines.

- Write an atomic `.cheatcodes/local/last-run.json`.
- Append structured records to `.cheatcodes/local/worker.jsonl`.
- Bound or rotate the worker log.
- Record invocation ID, PID, project, start time, stage, outcome, exit code, and duration.
- Never log API keys, prompts, full session records, evidence payloads, or model responses.
- Enforce the overall worker timeout inside the standalone process.
- Abort active curator sessions on timeout.
- Release the project lock in every terminal path.
- Preserve foreground console output for direct CLI use.
- Persist detached `auto` failures before exiting nonzero.

## Migration plan

Implement one idempotent migration before normal project loading.

1. Discover both `.cheatcodes/config.json` and `.cheatcodes/project.json` during the transition.
2. Validate the complete legacy config before changing any file.
3. Create the global config from the legacy model and resolved inputs when no global config exists.
4. Keep an existing global model when it conflicts with a legacy project model.
5. Merge resolved legacy inputs into the global input list without duplicates.
6. Move legacy `projectRoots` other than the current root into `projectAliases[projectId]`.
7. Write `.cheatcodes/project.json` atomically.
8. Move `state.json`, `operations/`, and a non-live lock into `.cheatcodes/local/`.
9. Publish or validate the knowledge bundle.
10. Remove `.cheatcodes/config.json` only after every target validates.
11. Make a repeated migration a no-op.
12. Report conflicts and recoverable cleanup through worker status instead of leaving backup files in the repository.

Do not migrate while a live legacy lock owner exists.

Update `.gitignore` so it ignores `.cheatcodes/local/` instead of the entire `.cheatcodes/` tree.

## Implementation phases

### Phase 1: Configuration and storage boundary

Files:

- `src/config.ts`
- `src/state.ts`
- `src/publish.ts`
- `.gitignore`

Actions:

1. Split global settings from `ProjectConfig` identity.
2. Add versioned validation and atomic global writes.
3. Add Git top-level discovery with an explicit non-Git fallback for programmatic tests.
4. Resolve configured inputs and project aliases centrally.
5. Move producer state paths under `.cheatcodes/local/`.
6. Publish an empty bundle during setup.
7. Replace hardcoded generated producer versions with the package version from one source.

### Phase 2: CLI and auto worker

Files:

- `src/cli.ts`
- `src/curate.ts`
- `src/scan.ts`
- new focused worker or logging module only if separation reduces `cli.ts`

Actions:

1. Replace ad hoc option scanning with strict command parsing.
2. Remove normal `init` flags.
3. Add `auto` orchestration.
4. Accept Pi session file hints through a documented integration environment contract.
5. Let scanning accept explicit JSONL files and directories.
6. Coalesce active locks in auto mode.
7. Add worker deadlines, status, and logs.
8. Prune state cursors whose configured inputs no longer contain their files.
9. Make `status` report discovered files instead of stale cursor count.

### Phase 3: Legacy migration

Files:

- `src/config.ts`
- `src/state.ts`
- migration tests and fixtures

Actions:

1. Implement the ordered migration above.
2. Cover missing, malformed, partial, conflicting, interrupted, and repeated migrations.
3. Remove legacy read paths after the compatibility window only in a later major release.

### Phase 4: Fire-and-forget extension

Files:

- `/home/joshsimon/Projects/pi-extensions/pi-cheatcodes/index.ts`
- `/home/joshsimon/Projects/pi-extensions/pi-cheatcodes/package.json`
- a real extension `tsconfig.json`
- extension unit tests

Actions:

1. Replace `pi.exec()` with detached `spawn()`.
2. Remove widget, scanner, foreground command, and hardcoded paths.
3. Add trust and event-reason gates.
4. Pass only plain one-way invocation hints.
5. Resolve `cheatcodes/cli` through a package export.
6. Update package metadata to describe a background launcher.
7. Add `cheatcodes` as a runtime dependency.
8. Add `@earendil-works/pi-coding-agent` as a `"*"` peer dependency.
9. Add the `pi-package` keyword when the extension is intended for distribution.

### Phase 5: Packaging and artifact cleanup

Files:

- both `package.json` files
- package lockfiles
- obsolete helper configs and documentation

Actions:

1. Export the compiled standalone CLI path for the extension.
2. Add a `files` allowlist for publishable artifacts.
3. Build in `prepack` so `dist/cli.js` cannot be stale.
4. Add extension check and test scripts.
5. Remove absolute local paths from maintained configs.
6. Mark superseded design documents clearly or remove them from active artifacts.
7. Update helper scripts to the global config API or delete them.
8. Verify both packages use compatible Node and Pi SDK ranges.

### Phase 6: Alignment and regression pass

Audit both projects together.

- Confirm the extension imports no cheatcodes internals.
- Confirm the standalone CLI imports no extension code.
- Confirm no hardcoded home, checkout, session, or `tsx` paths remain.
- Confirm no Pi UI completion path remains.
- Confirm current-session appends remain safe because only complete JSONL lines commit.
- Confirm new, resumed, and forked sessions do not create duplicate work.
- Confirm ephemeral sessions skip harvesting without breaking setup.
- Confirm malformed config and migration errors preserve all legacy files.
- Confirm generated and curated knowledge remain deterministic.

## Required tests

### Standalone tests

1. Global config path honors the environment, XDG, and home fallbacks.
2. Global config validation rejects unknown versions and invalid fields.
3. `init` from a repository subdirectory writes only at the Git top level.
4. `init` publishes a valid empty bundle and adds one context pointer.
5. `auto` outside a Git repository exits without writes.
6. `auto` skips when disabled.
7. `auto` sets up and runs a missing project by default.
8. `auto` uses a Pi model hint only to create a missing global config.
9. An existing global model is never overwritten by a Pi model hint.
10. Direct session-file and session-directory hints are scanned correctly.
11. A second auto worker coalesces successfully under the project lock.
12. Worker timeout aborts work, records failure, and releases the lock.
13. `status` reports current inputs and the last worker result.
14. Removed inputs prune obsolete cursors safely.
15. Legacy config and state migrate byte-safely and idempotently.
16. A model conflict preserves the global model and records a warning.
17. A failed migration leaves the complete legacy layout usable.
18. Existing deterministic incremental and partial-line tests continue to pass.

### Extension tests

1. `session_start` returns without awaiting child completion.
2. Spawn uses `detached: true`, `stdio: "ignore"`, `shell: false`, and `unref()`.
3. The extension never calls `pi.exec()`.
4. Reload events do not launch a worker.
5. Untrusted projects do not launch a worker.
6. Startup, new, resume, and fork events launch once.
7. Session, previous-session, model, and thinking hints are copied as plain strings.
8. Missing or ephemeral session files do not break launch.
9. Immediate spawn failure does not crash Pi.
10. No widget or completion notification API is called.

### Packaging and manual validation

Run these checks after implementation.

```text
cd /home/joshsimon/Projects/DSE-tests/cheat-codes
npm test
npm run build
npm pack --dry-run

cd /home/joshsimon/Projects/pi-extensions/pi-cheatcodes
npm test
npm run check
npm pack --dry-run
```

Then perform one manual Pi smoke test.

1. Start Pi in a trusted repository with no `.cheatcodes/project.json`.
2. Confirm the prompt becomes available without waiting for cheatcodes.
3. Confirm the detached worker creates the project layout and runs.
4. Start Pi again while the first worker is active.
5. Confirm the second launch coalesces and Pi remains responsive.
6. Disable `automation.enabled` globally and confirm no project mutation occurs.
7. Re-enable automation and set `setupMissingProjects` to false.
8. Confirm configured projects run while missing projects remain untouched.

## Completion criteria

- Pi startup performs no awaited cheatcodes I/O or process join.
- The extension is a one-way detached launcher with no completion channel.
- A trusted Git repository is initialized and processed automatically by default.
- All user settings live in one versioned global config.
- Repositories contain only project identity, durable knowledge, and ignored local producer state.
- Legacy projects migrate without data loss or leftover legacy config.
- Both packages build, test, and pack without hardcoded development paths or stale artifacts.
- The existing deterministic curation and publish guarantees remain intact.

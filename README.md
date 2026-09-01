# Cheatcodes

> Curate lessons from coding agent sessions into project guidance.

Cheatcodes is a Node.js CLI that turns Pi sessions into a project-local knowledge file, `.agents/CHEATCODES.md` by default.

## What it does

Coding agents lose project-specific context between sessions. Cheatcodes scans session logs for resolved failures, user corrections, explicit decisions, and validated procedures. A configured model decides whether the evidence supports durable guidance, then creates or updates an entry.

The curator receives only bounded evidence from each session. Later runs process only new or changed session data. Related guidance is updated instead of stored as chronological notes.

The result is plain Markdown beside the code. People and agents can read, edit, review, or delete it without a server, database, or retrieval service. Cheatcodes adds a short pointer from `AGENTS.md` by default.

Common secret formats are redacted before evidence reaches the curator model. Sessions outside the configured project roots are skipped. Entries sourced from skipped sessions are removed from the knowledge file on the next run. Runtime cursors and locks stay in the user's state directory rather than the project.

## Prerequisites

- Node.js 22.19 or newer
- Pi session logs
- A curator model available through a Pi-compatible model registry

## Install

Install as a Pi package:

```bash
pi install git:github.com/sij0sh/cheatcodes
```

Pi clones the package, and the committed build makes the CLI and extension work immediately. Keep it current with `pi update --extensions`.

Uninstall:

```bash
pi remove git:github.com/sij0sh/cheatcodes
```

To use only the standalone CLI without Pi:

```bash
npm install -g github:sij0sh/cheatcodes
```

To develop from a checkout, run `npm install && npm run build`.

## Configure

Create `~/.config/cheatcodes/config.json`:

```json
{
  "version": 2,
  "model": "provider/model",
  "inputs": [],
  "workerTimeoutMinutes": 10,
  "projectAliases": {}
}
```

Replace `provider/model` with a model from your registry. When Cheatcodes needs `~/.config/cheatcodes/models.json` for the first time, it copies Pi's registry if available. Otherwise, it creates an example registry for you to replace. It never overwrites an existing registry.

An empty `inputs` list automatically discovers `~/.pi/agent/sessions` when it exists. Set `PI_CODING_AGENT_DIR` to point at a different Pi agent directory.

Add other session files or directories to `inputs` as needed. Set `CHEATCODES_CONFIG` to use a different configuration file.

## First run

Run Cheatcodes from the project whose sessions you want to curate:

```bash
cd /path/to/project
cheatcodes run
cheatcodes status
```

`cheatcodes run` scans matching sessions, curates supported lessons, and creates `.agents/CHEATCODES.md`. By default, it also adds a pointer to `AGENTS.md`, or to `AGENTS.override.md` when the override file already exists. A knowledge file left at the legacy root location moves to the new default on the next run.

`cheatcodes status` reports discovered session files, skipped inputs, the entry count, map freshness, and the last run.

When the package is linked or installed, Pi loads its extension and starts a detached `cheatcodes ensure` at session start in trusted projects. Set `"autorun": false` or `CHEATCODES_ENSURE=0` to disable this.

## Automatic freshness

`cheatcodes ensure` is the one unattended verb. It curates changed sessions, runs the pending-episode curation workflow, and checks map freshness, then prints one JSON status (`refreshed`, `up-to-date`, `timeout`, `locked`, or `error`). Every status except `error` exits 0, so freshness work never blocks an agent launch.

The map check is free: it re-verifies cited `repo:` digests and compares a bounded inventory digest. A stale map is reported as `map: "stale (sources changed)"` or `map: "stale (inventory changed)"`. Synthesis is never automatic unless you pass `--map` or set `"autoMap": true`.

## Configuration reference

| Field | Purpose | Default |
| --- | --- | --- |
| `model` | Model used to curate evidence | Required |
| `inputs` | Session files or directories to scan | Discovered Pi sessions directory |
| `workerTimeoutMinutes` | Maximum run time | `10` |
| `knowledgeFile` | Project-relative output path | `.agents/CHEATCODES.md` |
| `contextPointer` | Add the knowledge pointer to agent instructions | `true` |
| `autorun` | Run `cheatcodes ensure` when a Pi session starts in a trusted project | `true` |
| `autoMap` | Resynthesize a stale map during ensure | `false` |
| `projectAliases` | Treat other paths as the same project | `{}` |

Set `"contextPointer": false` to leave agent instruction files unchanged. Set `knowledgeFile` to another project-relative path when `.agents/CHEATCODES.md` does not fit the repository layout.

## Repository synthesis

`cheatcodes map` reads the repository itself and caches cross-file understanding that is expensive to re-derive:

```bash
cheatcodes map --dry-run
cheatcodes map
```

It maintains at most three entries in `.agents/CHEATCODES.md`, titled `Project brief`, `System map`, and `Capability map`. Each entry must synthesize at least two repository files. Provenance is stored per entry as `repo:<relative-path>#sha256=<digest>` sources, and every digest is re-verified immediately before the commit; a changed or missing file aborts the run.

Synthesis runs only when you invoke the command. Re-running it updates the same entries. Existing entries that already restate a single canonical file (such as a README section) are rejected, so the map stays a compression of distributed truth rather than a documentation mirror.

## Output

`.agents/CHEATCODES.md` does not require Cheatcodes to be running. You can commit it, review changes in Git, edit entries directly, or remove guidance that no longer applies.

Cheatcodes stores processing state in the user's XDG state directory, which defaults to `~/.local/state/cheatcodes`. The project keeps only the knowledge file and, unless disabled, the agent instruction pointer.

Curation bookkeeping (transaction receipts, tombstones, reviews) lives beside that state. A missing state file starts a fresh project. An unreadable or invalid state file fails closed and names its path; restore or remove that file before running `cheatcodes maintain` or `cheatcodes ensure`. If you upgraded from a version that dropped verification metadata on curated updates, run `cheatcodes maintain` once so affected entries are re-nominated for verification.

## Environment variables

- `CHEATCODES_ENSURE_TIMEOUT`: ensure budget in seconds. Defaults to `120`.
- `CHEATCODES_ENSURE`: set to `0` to disable the session-start ensure trigger.
- `CHEATCODES_CONFIG`, `CHEATCODES_STATE`, `CHEATCODES_PROJECT_ROOT`: override the config file, state directory, and project root for unattended runs.

## License

[MIT](LICENSE). Copyright (c) 2026 Josh Simon.

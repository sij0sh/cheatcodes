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

From this repository:

```bash
npm install
npm run build
npm link
```

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

`cheatcodes status` reports discovered session files, skipped inputs, the entry count, and the last run.

When the package is linked or installed, Pi loads its extension and starts a detached `cheatcodes run` at session start in trusted projects. Set `"autorun": false` to disable this.

## Configuration reference

| Field | Purpose | Default |
| --- | --- | --- |
| `model` | Model used to curate evidence | Required |
| `inputs` | Session files or directories to scan | Discovered Pi sessions directory |
| `workerTimeoutMinutes` | Maximum run time | `10` |
| `knowledgeFile` | Project-relative output path | `.agents/CHEATCODES.md` |
| `contextPointer` | Add the knowledge pointer to agent instructions | `true` |
| `autorun` | Run `cheatcodes run` when a Pi session starts in a trusted project | `true` |
| `projectAliases` | Treat other paths as the same project | `{}` |

Set `"contextPointer": false` to leave agent instruction files unchanged. Set `"autorun": false` to require manual runs. Set `knowledgeFile` to another project-relative path when `.agents/CHEATCODES.md` does not fit the repository layout.

## Output

`.agents/CHEATCODES.md` does not require Cheatcodes to be running. You can commit it, review changes in Git, edit entries directly, or remove guidance that no longer applies.

Cheatcodes stores processing state in the user's XDG state directory, which defaults to `~/.local/state/cheatcodes`. The project keeps only the knowledge file and, unless disabled, the agent instruction pointer.

## License

[MIT](LICENSE). Copyright (c) 2026 Josh Simon.

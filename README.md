# Cheatcodes

> Turn hard-won lessons from coding-agent sessions into durable, inspectable project guidance.

Cheatcodes is a Node.js CLI that curates Pi and Claude Code sessions into a project-local `CHEATCODES.md` file.

## The problem

Coding agents repeatedly encounter project-specific gotchas, decisions, and working procedures. Those lessons usually remain buried in session logs, so later agents repeat failed approaches or need the same correction again.

Saving whole transcripts does not solve the problem. Transcripts contain noise, temporary details, and guidance that later work may replace. Manually maintaining a large instruction file is easy to postpone and hard to keep current.

Cheatcodes combines an agentic curation workflow with a simple file:

- The workflow finds high-signal episodes such as resolved failures, user corrections, explicit decisions, and validated procedures.
- A configured model decides whether the evidence supports durable guidance and whether to create or update an entry.
- The result stays in plain Markdown beside the code, where people and agents can read, edit, review, or delete it.

This split keeps the judgment where an agent is useful and keeps the memory in a format that needs no server, database, or retrieval service.

## Why use it?

- **Retrospective:** Capture lessons after the work, including corrections and successful recoveries.
- **Focused:** Send bounded evidence packets instead of entire transcripts to the curator model.
- **Incremental:** Process only new or changed session data on later runs.
- **Current:** Update related guidance instead of accumulating chronological notes.
- **Inspectable:** Keep project knowledge in a Git-friendly Markdown file.
- **Agent-visible:** Add a short pointer from `AGENTS.md` by default.

Common secret formats are redacted before evidence reaches the curator model. Runtime cursors and locks stay in the user's state directory rather than the project.

## Prerequisites

- Node.js 22.19 or newer
- Pi or Claude Code session logs
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

Replace `provider/model` with a model from your registry. When Cheatcodes first needs `~/.config/cheatcodes/models.json`, it copies Pi's registry if available. Otherwise, it creates an example registry for you to replace. It never overwrites an existing registry.

An empty `inputs` list enables automatic discovery of these directories when they exist:

- `~/.pi/agent/sessions`
- `~/.claude/projects`

Add other session files or directories to `inputs` when needed. Set `CHEATCODES_CONFIG` to use a different configuration file.

## First run

Run Cheatcodes from the project whose sessions you want to curate:

```bash
cd /path/to/project
cheatcodes run
cheatcodes status
```

`cheatcodes run` scans matching sessions, curates supported lessons, and creates `CHEATCODES.md`. By default, it also creates or updates `AGENTS.md`, or `AGENTS.override.md` when that file already exists, with a pointer to the knowledge file.

`cheatcodes status` reports discovered session files, skipped inputs, the entry count, and the last run.

## Configuration reference

| Field | Purpose | Default |
| --- | --- | --- |
| `model` | Model used to curate evidence | Required |
| `inputs` | Session files or directories to scan | Discovered Pi and Claude Code directories |
| `workerTimeoutMinutes` | Maximum run time | `10` |
| `knowledgeFile` | Project-relative output path | `CHEATCODES.md` |
| `contextPointer` | Add the knowledge pointer to agent instructions | `true` |
| `projectAliases` | Treat other paths as the same project | `{}` |

Set `"contextPointer": false` to leave agent instruction files unchanged. Set `knowledgeFile` to another project-relative path when `CHEATCODES.md` does not fit the repository layout.

## Output

`CHEATCODES.md` is useful without Cheatcodes running. Commit it, review changes in Git, edit entries directly, or remove guidance that no longer applies.

Cheatcodes stores its processing state under the user's XDG state directory, or `~/.local/state/cheatcodes` by default. The project keeps only the knowledge file and, unless disabled, the agent-instruction pointer.

## License

[MIT](LICENSE) - Copyright (c) 2026 Josh Simon.

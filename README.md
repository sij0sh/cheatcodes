# Cheatcodes

Turn lessons from coding-agent sessions into a small, reusable project memory.

Cheatcodes reads past Pi and Claude Code sessions, finds durable lessons, and keeps them in `CHEATCODES.md`.

## Why use it?

- **Retroactive:** learn from corrections, failed attempts, decisions, and working fixes after the work is done.
- **Lean:** process only new or changed session data. No server, database, dashboard, or project-local runtime directory.
- **Simple:** keep the result as readable Markdown beside the code.
- **Current:** update old guidance instead of piling new notes on top of it.
- **Portable:** point agents to the same knowledge through `AGENTS.md`.

Cheatcodes is useful when the same lessons keep coming up across agent sessions, but maintaining a large instruction file by hand is not.

## How it works

1. Scan Pi and Claude Code session logs for the current project.
2. Look for high-signal moments such as user corrections, resolved failures, decisions, and repeatable procedures.
3. Send a small, redacted evidence packet to your chosen model.
4. Create or update an entry in `CHEATCODES.md`.
5. Remember what was processed so the next run only handles changes.

Raw transcript excerpts are not copied into the knowledge file. Common secrets are redacted before curation.

## Compared with other approaches

| Approach | Tradeoff | What Cheatcodes adds |
| --- | --- | --- |
| Handwritten `AGENTS.md` or `CLAUDE.md` | Very simple, but someone must notice and record every lesson | Learns retrospectively and adds a small pointer to the generated knowledge |
| Transcript search or archives | Keeps everything, including noise and outdated advice | Keeps only durable, current project guidance |
| Memory servers and RAG systems | Powerful retrieval, with more infrastructure and hidden state | One inspectable Markdown file and incremental local state |

Cheatcodes is deliberately narrower. It is project memory, not chat search or a general knowledge base.

## Start up

Requires Node.js 22.19 or newer.

### 1. Install from this repository

```bash
npm install
npm run build
npm link
```

### 2. Choose a curator model

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

If Pi is installed, Cheatcodes copies Pi's model registry the first time it needs one. Otherwise it creates `~/.config/cheatcodes/models.json` with an example provider for you to replace. Existing model files are never overwritten.

Empty `inputs` are fine. On startup, Cheatcodes discovers these folders when present:

- `~/.pi/agent/sessions`
- `~/.claude/projects`

You can also add other session folders to `inputs`.

### 3. Run it from a project

```bash
cd /path/to/project
cheatcodes run
cheatcodes status
```

The first run creates:

- `CHEATCODES.md`, containing curated project knowledge
- a short `AGENTS.md` pointer so compatible agents know where to look

Runtime cursors and locks stay in the user's state directory, not in the project. Set `"contextPointer": false` if you do not want Cheatcodes to touch `AGENTS.md`.

## Sister shims

Cheatcodes is the shared engine. Its Pi and Claude Code sister shims are thin, host-specific launchers.

They run Cheatcodes at the right point in each agent's lifecycle and pass available context, such as the current project, session file, or model. They do not maintain a second knowledge store or implement separate learning logic.

Use a shim for automatic runs inside its supported agent. Use `cheatcodes run` when you want a manual or tool-independent workflow. Both paths update the same `CHEATCODES.md`.

## Commands

```text
cheatcodes run      Process new session data for the current project
cheatcodes status   Show inputs, entry count, and the last run
```

## Output

`CHEATCODES.md` is plain Markdown. Read it, edit it, review it in Git, or remove entries you no longer want. The file remains useful even without Cheatcodes running.

## Configuration

| Field | Purpose | Default |
| --- | --- | --- |
| `model` | Model used to curate evidence | Required |
| `inputs` | Session files or folders to scan | Discovered Pi and Claude Code folders |
| `workerTimeoutMinutes` | Maximum run time | `10` |
| `knowledgeFile` | Project-relative output path | `CHEATCODES.md` |
| `contextPointer` | Add the knowledge pointer to `AGENTS.md` | `true` |
| `projectAliases` | Treat other paths as the same project | `{}` |

Set `CHEATCODES_CONFIG` to use a different config path.

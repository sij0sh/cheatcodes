# cheatcodes

A standalone CLI that turns coding-agent sessions into a durable knowledge base for your projects.

Coding agents repeat solved mistakes. Session transcripts pile up and nothing extracts the rules that matter. cheatcodes reads your Pi and Claude Code session files, curates durable engineering rules with your model, and writes them to `CHEATCODES.md` at the project root. Your agents read that file on the next session and stop repeating history.

## How it works

1. A launcher spawns `cheatcodes run` when a session starts, or you run it yourself.
2. cheatcodes reads session JSONL from Pi (`~/.pi/agent/sessions`) and Claude Code (`~/.claude/projects`). It discovers these roots on first run and persists them in its global config.
3. It processes only new bytes. File cursors, record hashes, and a project lock make repeat runs cheap and safe.
4. Your configured model curates substantive exchanges into knowledge entries. A correction like "No, use the repository adapter" becomes a rule. Trivial traffic (file listings, read receipts) is dropped.
5. It writes `CHEATCODES.md` and adds a pointer to `AGENTS.md` so coding agents find it.

## Example

A session correction becomes a curated entry:

```markdown
<!-- cheatcodes-entry {"id":"cc-4e5f...","title":"Use the OpenAI Codex provider for GPT-5.6 Luna","summary":"gpt-5.6-luna is registered under openai-codex, not z-ai-openai.","date":"2026-08-29T00:25:14.239Z","tags":["openai","model-routing"],"sources":["session:01a04abf-...#records=61eb19fa"]}-->
## Use the OpenAI Codex provider for GPT-5.6 Luna

gpt-5.6-luna is registered under openai-codex, not z-ai-openai.

Using z-ai-openai/gpt-5.6-luna fails before the first model call.
<!-- /cheatcodes-entry -->
```

Each entry is self-describing markdown with a title, summary, date, tags, and source references back to the session. `AGENTS.md` gains one pointer:

```markdown
## Project knowledge

Start with `CHEATCODES.md`.
```

## Features

- **Multi-harness input**: reads Pi and Claude Code sessions. Handles both JSONL formats and their tool-call shapes.
- **Incremental by design**: commits complete records only, tracks byte cursors and prefix hashes, and detects rewritten files.
- **Curation guardrails**: schema-validated model output, deduplication, additive updates, provenance per entry, and redaction of common credential shapes.
- **Safe concurrency**: project lock with coalescing and stale recovery. Two launches in one project collapse into one run.
- **Bounded work**: worker timeout (default 10 minutes) kills runaway curation.
- **Scoped output**: paths inside the project are normalized relative to the project root; outside paths are redacted.
- **Global configuration**: one config file for all projects; project identity derives from the project directory path.

## Install

Requirements: Node >= 22.19 and an LLM provider that your model string resolves to.

```sh
git clone https://github.com/<your-account>/cheat-codes.git
cd cheat-codes
npm install
npm install -g .        # or: npm link
```

Create the global config once, from any project directory:

```sh
CHEATCODES_PI_MODEL="provider/model" cheatcodes run
```

`run` skips when no config exists and no model hint is available. Every later run processes only new session bytes.

## Configuration

Global config lives at `~/.config/cheatcodes/config.json` (override with `CHEATCODES_CONFIG`).

```json
{
  "version": 2,
  "model": "provider/model",
  "inputs": ["~/.pi/agent/sessions", "~/.claude/projects"],
  "workerTimeoutMinutes": 10,
  "knowledgeFile": "CHEATCODES.md",
  "contextPointer": true,
  "projectAliases": {}
}
```

| Field | Default | Purpose |
| --- | --- | --- |
| `model` | required | Curator model as `provider/model` |
| `inputs` | discovered | Extra session files or directories to scan |
| `workerTimeoutMinutes` | `10` | Hard deadline for one run |
| `knowledgeFile` | `CHEATCODES.md` | Project-relative output path |
| `contextPointer` | `true` | Write the `AGENTS.md` pointer |
| `projectAliases` | `{}` | Extra project roots per project key |

Run state (cursors, last-run record) lives at `~/.local/state/cheatcodes/state.json` (override with `CHEATCODES_STATE`).

## Commands

| Command | Effect |
| --- | --- |
| `cheatcodes run` | Process new session bytes for this project. `auto` is an alias. |
| `cheatcodes status` | Show project key, discovered inputs, entry count, last run. |

## Launchers (set and forget)

Launchers only trigger `cheatcodes run` as a detached, fire-and-forget process. They add no foreground work to agent startup.

| Launcher | Trigger | Repository |
| --- | --- | --- |
| `pi-cheatcodes` | Pi `session_start` event | `github.com/<your-account>/pi-cheatcodes` |
| `claude-cheatcodes` | Claude Code `SessionStart` hook | `github.com/<your-account>/claude-cheatcodes` |

Without a launcher, run `cheatcodes run` manually in any project directory. Incremental processing keeps it fast.

## Uninstall

```sh
npm uninstall -g cheatcodes
rm -rf ~/.config/cheatcodes ~/.local/state/cheatcodes
```

Remove `CHEATCODES.md` and the `AGENTS.md` pointer from any project where you no longer want curated knowledge.

## Development

```sh
npm test              # unit suite, no network
npm run test:live     # opt-in live-model smoke test; refuses to run with CI=true
```

## License

MIT.

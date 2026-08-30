# Changelog

## 0.3.0 (unreleased)

Breaking simplification: one repo artifact, global config and state.

### Changed

- `CHEATCODES.md` at the repository root is now the only repository artifact. It holds all curated entries in a self-describing markdown format; `.cheatcodes/` is no longer created or read. Back up and delete any existing `.cheatcodes/` tree after migrating anything you want to keep.
- The knowledge file location defaults to `CHEATCODES.md` in the repository root and is configurable with the optional global `knowledgeFile` field (a repository-relative path, e.g. `".pi-files/CHEATCODES.md"`). The AGENTS.md pointer and `status` output follow the configured path.
- Global config is now version 2: `{ "version": 2, "model", "inputs", "workerTimeoutMinutes", "projectAliases" }`. The `automation` block was removed and version 1 files are rejected with a migration hint.
- Run state (file cursors and the last-run record) moved to the global state file at `$XDG_STATE_HOME/cheatcodes/state.json` (`~/.local/state/cheatcodes/state.json` by default). Override with `CHEATCODES_STATE`.
- Project identity is derived from the Git `origin` remote (or the repository path) as a project key; no `project.json` is written.
- Curated entries use plain markdown bodies with a `summary` and optional `tags`/`sources` provenance. Evidence excerpts and addendum history are no longer stored.
- Entry metadata carries a `date` stamp in UTC, set from the source session file's last-modified time. It refreshes when a later session updates the entry.
- `auto` is an alias of `run`; the launcher now spawns `run`.

### Removed

- `cheatcodes init` and `cheatcodes publish`. The knowledge file is created on demand by `run`.
- The operation journal, legacy project migration, and the worker module. All behavior moved into `run` and `status`.

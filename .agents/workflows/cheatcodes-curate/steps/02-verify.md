# Verify claims against current truth

You receive the qualified verdicts. For every accepted claim, establish whether
it is true of the project right now:

- `read` the project files the claim's evidence references, relative to the
  project root; page with `offset` and `limit` for long files.
- For claims about existing guidance, `read` the project knowledge file
  (`.agents/CHEATCODES.md` by default).

Record each claim as `current`, `stale` (code moved on), `contradicted`
(project demonstrates the opposite), or `unverified` (no safe check exists).

Drop claims that verify as `stale` or `contradicted` from later steps; keep
them in the output with their status so the decision is auditable. Park the run
when a claim cannot be checked safely at all.

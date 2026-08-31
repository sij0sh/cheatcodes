# Verify claims against current truth

You receive the qualified verdicts. For every accepted claim, establish whether
it is true of the project right now:

- `inspect_project_fact` to read the referenced files or search them.
- `verify_command` only with an allowlisted command id, never shell text.

Record each claim as `current`, `stale` (code moved on), `contradicted`
(project demonstrates the opposite), or `unverified` (no safe check exists).

Drop claims that verify as `stale` or `contradicted` from later steps; keep
them in the output with their status so the decision is auditable. Park the run
when a claim cannot be checked safely at all.

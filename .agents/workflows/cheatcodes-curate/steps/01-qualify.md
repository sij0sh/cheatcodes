# Qualify episodes

The workflow target is the manifest id. Read the manifest at
`.agents/cheatcode-runs/<manifest-id>.json` with `read`. It is pretty-printed
JSON and can exceed one read; page through it with `offset` and `limit`.

List the packets from the `packets` array (`id`, `signals`, `userIntent` for
each), then read each packet's `evidence`, `shortlist`, `closure`, and
`finalAssistantSummary` fields in the same file. Evaluate every packet; do not
skip any.

For each packet decide one verdict:

- `accept`: the episode yields durable, project specific guidance (a gotcha,
  decision, procedure, or invariant). It must not be an active loop, an
  architecture inventory, or a step-by-step of routine implementation work.
- `reject`: transient audit or implementation state, already-known guidance,
  or guidance contradicted by a newer episode.
- `needs-review`: plausibly valuable but the evidence is ambiguous or the
  closure is incomplete.

Every accepted claim must cite evidence ids that exist in the packet. Do not
copy packet text wholesale; write the minimal durable claim.

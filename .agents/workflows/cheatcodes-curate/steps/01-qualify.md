# Qualify episodes

The workflow target is the manifest id. Call `load_evidence_episode` with just
that manifest id to list its packets, then load each packet id it returned.
Evaluate every packet; do not skip any.

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

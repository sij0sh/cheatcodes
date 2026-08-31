# Reconcile with the corpus

You receive the qualified verdicts and the verified claims. Work only with
claims whose verification status is `current`.

Call `search_knowledge` for the topic of each claim. Decide per claim:

- New guidance: propose a `create` operation.
- Existing entry is incomplete or outdated in a compatible way: propose
  `update` with `target: {id, expectedDigest}` from the search result and a
  complete replacement payload.
- Existing entry says the opposite: do not mutate it; propose `needs-review`
  with the conflict described.

Propose at most one operation per topic and at most eight operations total.
Every operation must carry the packet ids it came from. Write the transaction
with `baseRevision` taken from the manifest context: use the corpus revision
reported by `search_knowledge` results.

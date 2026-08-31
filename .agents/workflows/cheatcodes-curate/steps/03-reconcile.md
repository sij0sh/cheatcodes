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
Use exactly these operation shapes; the staging tool rejects anything else.

- `create`: `{op: "create", entry: {title, summary, body}, evidenceRefs: [...]}`
- `update`: `{op: "update", target: {id, expectedDigest}, entry: {title, summary, body}}`
- `keep`: `{op: "keep", target: {id, expectedDigest}, reason: "..."}`
- `needs-review`: `{op: "needs-review", targets: [id, ...], conflict: "...", nextAction: "..."}`

`target.expectedDigest` is the entry digest from the `search_knowledge` result.
Never put `packetIds` inside an operation; the transaction-level `packetIds`
array carries them. Write the transaction with `baseRevision` from the corpus
revision reported by the `search_knowledge` results.

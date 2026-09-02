# Reconcile with the corpus

You receive the qualified verdicts and the verified claims. Work only with
claims whose verification status is `current`.

Read the project knowledge file (`.agents/CHEATCODES.md` by default), and read
the `corpusRevision` field near the top of the manifest at
`.agents/cheatcode-runs/<manifest-id>.json`. Compare each claim against the
entries. Decide per claim:

- New guidance: propose a `create` operation.
- Existing entry is incomplete or outdated in a compatible way: propose
  `update` with `target: {id}` and a complete replacement payload.
- Existing entry says the opposite: do not mutate it; propose `needs-review`
  with the conflict described.

Propose at most one operation per topic and at most eight operations total.
Use exactly these operation shapes:

- `create`: `{op: "create", entry: {title, summary, body}, evidenceRefs: [...]}`
- `update`: `{op: "update", target: {id}, entry: {title, summary, body}}`
- `keep`: `{op: "keep", target: {id}, reason: "..."}`
- `needs-review`: `{op: "needs-review", targets: [id, ...], conflict: "...", nextAction: "..."}`

Never set `expectedDigest`: it cannot be computed from a read, so the host
injects the live digest for each target when it stages. Never put `packetIds`
inside an operation; the transaction-level `packetIds` array carries them.
Set the transaction's `baseRevision` to the manifest's `corpusRevision`.

---
description: Qualify harvested episodes, verify claims against current project truth, reconcile with the corpus, challenge mutations, and decide one transaction; the host stages and applies it after the workflow completes.
legalTools: [read]
contracts:
  qualified: contracts/qualified.schema.json
  verified: contracts/verified.schema.json
  transaction: contracts/transaction.schema.json
  challenged: contracts/challenged-transaction.schema.json
steps:
  - run: steps/01-qualify.md
    id: qualify
    done: [verdicts-recorded]
    output: qualified
  - run: steps/02-verify.md
    id: verify
    done: [claims-verified]
    output: verified
    inputs:
      qualified: { from: qualify, select: /data }
  - run: steps/03-reconcile.md
    id: reconcile
    done: [transaction-proposed]
    output: transaction
    inputs:
      qualified: { from: qualify, select: /data }
      verified: { from: verify, select: /data }
  - run: steps/04-challenge.md
    id: challenge
    done: [mutation-decided]
    output: challenged
    inputs:
      verified: { from: verify, select: /data }
      transaction: { from: reconcile, select: /data }
---

# Cheatcodes curation

The workflow target is a manifest id. The manifest holds up to eight harvested
episodes from this project. Apply only what the manifest contains.

This workflow is read-only. Use the `read` tool for every file access. The
host validates and stages the decided transaction only after the workflow
completes.

Be conservative. Reject transient audit chatter, implementation inventories,
and anything inferable from the current code. Accept only durable, project
specific guidance that the episode evidences and that still holds true today.

Park the run (status blocked) when evidence is missing, current verification is
impossible, or human judgment is required. Do not guess.

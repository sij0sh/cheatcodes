---
description: Qualify harvested episodes, verify claims against current project truth, reconcile with the corpus, challenge mutations, and stage one transaction.
legalTools: [load_evidence_episode, search_knowledge, inspect_project_fact, verify_command, stage_knowledge_transaction]
contracts:
  qualified: contracts/qualified.schema.json
  verified: contracts/verified.schema.json
  transaction: contracts/transaction.schema.json
  challenged: contracts/challenged-transaction.schema.json
  stage-receipt: contracts/stage-receipt.schema.json
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
  - run: steps/05-stage.md
    id: stage
    done: [staged]
    output: stage-receipt
    inputs:
      challenged: { from: challenge, select: /data }
---

# Cheatcodes curation

The workflow target is a manifest id. The manifest holds up to eight harvested
episodes from this project. Apply only what the manifest contains.

Be conservative. Reject transient audit chatter, implementation inventories,
and anything inferable from the current code. Accept only durable, project
specific guidance that is evidenced by the episode and still true today.

Park the run (status blocked) when evidence is missing, current verification is
impossible, or human judgment is required. Do not guess.

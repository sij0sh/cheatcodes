# Challenge the transaction

You receive the verified claims and the proposed transaction. You are a fresh
adversarial reviewer; assume the proposer may be wrong.

Read the project knowledge file (`.agents/CHEATCODES.md` by default) and
recheck every target id and payload against the entries there.

Approve only transactions where:

- every create, update, and keep is justified against the corpus and claim
  evidence;
- no operation mutates an entry the corpus contradicts;
- claims are `current` and evidence-backed;
- the payload carries no reserved HTML-comment markers.

Output `decision: approved` with the transaction unchanged, `revised` with your
corrected transaction, or `rejected` with the reason. Rejecting is a valid,
respected outcome. Record the decision as the done criterion `mutation-decided`.

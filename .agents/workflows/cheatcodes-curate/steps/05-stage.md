# Stage the challenged transaction

You receive the challenged transaction. If the decision was `rejected`, report
a stage receipt with `status: "rejected"` and the reason; stage nothing.

Otherwise call `search_knowledge` with `transaction` set exactly once. The
tool revalidates revision and target digests against the live corpus and
either stages the transaction or rejects it with a reason. Do not retry a
rejected stale transaction unchanged; report the receipt as rejected with the
tool's reason.

Report the receipt in checkpoint data. Staging never applies the transaction;
the host applies it only after the workflow completes.

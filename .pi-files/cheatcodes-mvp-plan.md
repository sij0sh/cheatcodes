# cheat-codes MVP implementation plan

## 1. Goal

Build a standalone CLI that converts Pi session JSONL transcripts into curated OKF v0.2 Markdown knowledge.

The product boundary is strict:

- Session JSONL is episodic evidence.
- `.cheatcodes/curated/` is the editable source of truth.
- `.cheatcodes/knowledge/` is a generated OKF bundle.
- Snoop and other tools are optional consumers.

The MVP must meet four core guarantees:

1. An unchanged input set with up-to-date outputs causes zero LLM calls and zero file changes.
2. Every LLM packet contains at least one new or rewritten session record.
3. Deleting `knowledge/` and running `publish` recreates a byte-identical bundle.
4. The application, not the model, owns concept identity, lifecycle metadata, and provenance.

## 2. Review outcomes

The original plan had a strong boundary, a narrow concept set, deterministic harvesting, and concrete acceptance tests. It also deferred the review UI, Snoop integration, and semantic deduplication correctly.

The revised plan closes these gaps:

| Principle | Gap | Revision |
| --- | --- | --- |
| KISS | Incremental chunks could split tool calls, validation chains, and user turns. | Re-scan a changed file deterministically and send only episodes containing new records to the LLM. |
| KISS | Physical JSONL order could join sibling branches. | Build the Pi parent graph and segment each branch independently. |
| KISS | `log.md` required history that the planned state could not reproduce. | Omit the optional log until an event ledger exists. |
| KISS | A hand-written YAML parser would need to support nested OKF metadata. | Use one standards-compliant YAML library. |
| DRY | LLM-generated slugs also acted as concept IDs. | Use the application ID as the entire filename and keep display text in frontmatter. |
| DRY | Config duplicated thinking level in two fields. | Store one `provider/model[:thinking]` value and use `resolveCliModel()`. |
| DRY | The publisher could reimplement concept parsing. | Export one frontmatter reader and writer from `concept.ts`. |
| YAGNI | Repeated-procedure mining required history that the MVP did not store. | Detect a runbook only from one explicit, successful procedure. |
| YAGNI | Required live-provider tests would be slow, costly, and brittle. | Use a fake curator in required tests and keep one opt-in SDK smoke test. |
| Safety | Packets could expose credentials or large tool output. | Redact and cap evidence before any model call. |
| Reliability | A crash between a concept write and cursor update could replay a create with a new random ID. | Persist a transient mutation operation before changing canonical files. |
| DRY | An update packet exposed metadata but not the body it could overwrite. | Include the current draft and apply only additive updates. |
| KISS | The concept review proposed a separate structured concept registry. | Use canonical Markdown plus a transient operation journal for the MVP. |

## 3. Scope

### In scope

- Scan user-selected folders recursively for Pi `*.jsonl` sessions.
- Support linear v1 sessions and parent-linked v2 or v3 sessions.
- Resolve one configured model through Pi's `ModelRuntime` and `resolveCliModel()`.
- Track input progress with a per-file byte cursor and prefix digest.
- Produce `Decision`, `Gotcha`, and `Runbook` concepts.
- Store canonical concepts as Markdown with YAML frontmatter.
- Generate a conformant OKF v0.2 bundle and directory indexes.
- Add an idempotent project-knowledge pointer to Pi's active project context file during `init`.
- Apply basic deterministic secret redaction before model calls.

### Out of scope

- Interactive review UI and approval queues.
- `Invariant`, `Supersession`, and other concept types.
- Portable evidence excerpts under `references/sessions/`.
- A normalized session ledger, durable packet archive, or durable operation history.
- LLM response caching.
- Embeddings, vector search, and an LLM deduplication pass.
- Cross-project concept registries.
- Automatic reconciliation when a source session is rewritten or deleted.
- A historical event ledger and `log.md`.
- Repeated-procedure mining across sessions.
- Snoop-specific integration.
- Sessions whose header `cwd` sits outside every configured project root.

## 4. Storage layout

```text
.cheatcodes/
├── config.json
├── state.json
├── operations/          # transient crash-recovery mutations
├── run.lock             # exclusive mutation lock while a command runs
├── curated/
│   └── concepts/
│       └── <concept-id>.md
└── knowledge/
    ├── index.md
    └── concepts/
        ├── index.md
        └── <concept-id>.md
```

Rules:

- `curated/` is the only editable concept store.
- `knowledge/` is a derived view.
- A generated copy does not create a second source of truth.
- The application generates `concept-id` once and never changes it.
- The filename is exactly `<concept-id>.md`.
- Type, title, and description never participate in identity.
- `publish` validates every curated concept before replacing `knowledge/`.
- `publish` stages and validates a complete temporary tree before replacing `knowledge/`.
- The root index contains `okf_version: "0.2"` frontmatter.
- `concepts/index.md` contains no frontmatter.
- The MVP omits `log.md` because OKF makes it optional.
- `operations/` contains only in-flight mutation plans and is empty after a successful run.
- A mutation plan stores exact intended concept writes, but never stores a raw packet or model response.
- `run` and `publish` hold one exclusive project mutation lock.
- A second writer exits without changing state.
- The lock implementation releases ownership when its process exits and reports stale-lock recovery.

Use a standards-compliant YAML package. Do not implement a line-based YAML parser.

Canonical concept frontmatter uses this shape:

```yaml
---
cheatcodes_id: c7f3a91b2d
type: Gotcha
title: KDE service menus must be executable
description: Executable permission is required for KDE service-menu files.
tags: [kde, permissions]
status: draft
generated: { by: cheatcodes/0.1, at: 2026-08-28T00:00:00Z }
sources:
  - id: session-abc-records-41-68
    resource: session:abc#entries=41-68
    title: Session evidence
---
```

`verified` remains absent until a human or process verifies the concept. `cheatcodes_id` is a producer-defined OKF extension.

## 5. Configuration

`cheatcodes init --model <provider/model[:thinking]> --input <folder>` creates `.cheatcodes/config.json`. The `--input` option is repeatable.

```json
{
  "projectId": "github.com/example/cheat-codes",
  "model": "anthropic/claude-sonnet-4-5:medium",
  "inputs": ["/path/to/pi/sessions"],
  "projectRoots": ["."]
}
```

Rules:

- `model` is required.
- `projectId` is required.
- `init` derives `projectId` from the normalized Git remote when available.
- Without a Git remote, `init` generates a persistent local project ID.
- `model` uses Pi CLI model syntax.
- `inputs` accepts absolute paths or paths relative to the project root.
- `projectRoots` identifies the repository paths that the knowledge applies to.
- Relative project roots resolve from the directory that contains `.cheatcodes/`.
- A session is eligible when its header `cwd` equals or sits below an allowed project root.
- The MVP does not inspect unrelated-cwd sessions for project-touching receipts.
- A user can add an old checkout path to `projectRoots` after moving a repository.
- Treat every project root as an alias for the same logical repository.
- Normalize a path as `repo://<projectId>/<relative-path>` by stripping the longest matching root.
- The scanner always skips `.cheatcodes`, `.git`, and `node_modules`.
- Before the first model call, an unknown model fails without advancing input state.
- When the model omits a thinking suffix, use `medium`.
- The CLI does not fall back to an arbitrary available model.

Keep packet limits and receipt limits as internal constants until users need to tune them.

## 6. State and incremental processing

`state.json` contains only local producer state.

```json
{
  "version": 1,
  "files": {
    "/absolute/path/session.jsonl": {
      "sessionId": "session-uuid",
      "committedOffset": 48213,
      "observedSize": 48213,
      "mtimeMs": 1730000000,
      "prefixSha256": "sha256-of-bytes-through-committed-offset"
    }
  }
}
```

Use this algorithm for each file:

1. Skip the file when its size and mtime match `observedSize` and `mtimeMs`.
2. Stream a changed file from the beginning.
3. Parse only newline-terminated records.
4. Hash bytes through the previous `committedOffset`.
5. Treat the file as appended when the previous prefix digest and session ID still match.
6. Mark records ending after the previous `committedOffset` as new.
7. Treat the file as rewritten when its prior prefix or session ID does not match.
8. Mark every complete record in a rewritten file as new.
9. Build packets with old deterministic context, but require at least one new record in every packet.
10. Deduplicate packets by deterministic packet ID.
11. Replay an existing operation file without making another model call.
12. Advance the cursor only after every packet reaches a terminal outcome.
13. Write `state.json` with a temporary file and atomic rename.
14. Delete the file's completed operation records only after the state write succeeds.

A deterministic full re-scan of a changed file is an intentional MVP tradeoff. It keeps branch handling and cross-cursor context correct without adding a normalized event store.

A trailing partial JSON line remains uncommitted. A later append can complete that line.

A malformed complete line produces a warning and remains committed. The warning includes the source file and byte range, but not the line content.

State advances after an episode produces concepts, produces no concepts, or fails both schema attempts. This rule preserves the zero-call no-op guarantee. The CLI reports a terminally skipped episode by packet ID.

Model setup and transport failures do not advance the affected file cursor.

Canonical concept writes complete before state advances. Publishing runs after state advances because it is deterministic and can be retried with `cheatcodes publish`.

For each terminal packet outcome, write `operations/<packet-id>.json` atomically before changing canonical files. A successful outcome stores exact intended concept writes. An empty or schema-invalid outcome stores a no-op marker. Replay the same operation when a crash leaves it behind. This transient journal prevents duplicate random IDs without creating a durable event store.

Each create operation records that its target must be absent. Each update operation records the target's expected SHA-256. Replay succeeds when the intended hash is already present or the expected state still matches. Replay stops on any other state and leaves the cursor unchanged.

## 7. Pipeline

One `run` executes six stages.

### Stage 1: Discover

- Resolve and deduplicate configured input folders.
- List `*.jsonl` files recursively.
- Read each new or changed session header before accepting the file.
- Reject sessions whose header `cwd` is outside every `projectRoot` with a warning.
- Compare file metadata with `state.json`.
- When no input changed, skip model-runtime creation and run only the publisher's up-to-date check.

### Stage 2: Parse and normalize

Stream each changed file and retain compact normalized records.

Retain:

- Substantive user messages.
- Final assistant text with `stopReason: "stop"`.
- Tool calls and results paired by `toolCallId`.
- `bashExecution` messages with explicit exit codes.
- Accepted `workflow_transition` calls and results.
- Record IDs, parent IDs, timestamps, byte ranges, and session IDs.

Drop by default:

- Assistant thinking blocks.
- Images and base64 data.
- Compaction text and repeated snapshots.
- Full file-read output.
- Routine directory listings.
- Failed guessed-path reads.
- Unknown custom payloads.

For v2 and v3, build a parent graph from `id` and `parentId`. Never infer conversational adjacency from physical line order. For v1, use file order as one linear branch.

For v1, derive each stable synthetic record ID from the persistent session ID, byte range, and record-byte hash. Existing IDs must survive later appends.

Create conservative tool receipts:

- `read`: normalized path and content hash.
- `edit`: normalized path and available patch excerpt.
- `write`: normalized path and content hash.
- `bash`: normalized command, explicit exit code when available, and capped result excerpt.
- `workflow_transition`: node, accepted status, summary, decisions, and evidence fields.

Do not treat `isError: false` as proof that a shell validation passed. Accept an explicit zero exit code only for a simple command. Require a recognized result summary for pipelines, compound commands, or commands that can mask failure.

Normalize repository paths before packet rendering. Do not place absolute home paths in a model packet or concept source.
Resolve every matching project-root alias to the same `repo://<projectId>/<relative-path>` identity. Use the longest matching root.

Apply deterministic redaction before packet rendering. Redact common API keys, bearer tokens, private keys, credentials in URLs, and secret-looking environment assignments. Drop a command or excerpt when safe redaction is uncertain.

### Stage 3: Segment and harvest

Segment records along each parent path.

Use these boundaries in order:

1. Explicit workflow run and node boundaries.
2. Substantive user turns.
3. Final assistant responses.

Every episode in an accepted session belongs to the matched project root.

Emit a packet only when an episode has at least one new record and one high-signal pattern:

1. A failed validation, a mutation, and a later confirmed validation.
2. A substantive user correction or rejected approach.
3. An accepted workflow checkpoint with decisions or evidence.
4. Explicit decision language with user acceptance, an accepted checkpoint, or implementation evidence.
5. An explicit multi-step procedure followed by confirmed validation or user endorsement.

Do not implement cross-session frequency analysis in the MVP.

Deduplicate packet IDs before model calls so shared branch prefixes cannot emit the same episode more than once.

Process packets sequentially. Before each model call, reload canonical concepts and attach a fresh shortlist and update candidate. Apply or terminally skip that packet before preparing the next one.

Each packet contains:

- A deterministic packet ID.
- Project and session identity.
- Ordered source record IDs.
- User intent.
- Final assistant summary.
- Evidence items with deterministic IDs, kinds, excerpts, and source record IDs.
- A small deterministic shortlist of related concepts.
- The complete current content of at most one draft update candidate.

Rank the related shortlist by type, title terms, tags, and normalized paths. Cap the shortlist at eight concepts. Include each concept's application ID, title, type, description, and status. Select the top unverified draft as the only update candidate. Omit the update candidate when its current content does not fit the packet cap.

Use an internal packet cap of 12,000 characters. Preserve update-candidate content, user intent, final summaries, and evidence IDs before low-priority excerpts.

### Stage 4: Curate with the Pi SDK

When at least one packet exists, create `ModelRuntime`, resolve the configured model, and load the isolated resource loader once.

Create one in-memory agent session per packet. Disable tools, extensions, skills, prompt templates, themes, and context files. Dispose each session in a `finally` block.

The model returns one strict JSON object. The response uses a discriminated schema for `Decision`, `Gotcha`, and `Runbook` content.

Common fields:

```json
{
  "concepts": [
    {
      "action": "create",
      "type": "Gotcha",
      "title": "KDE service menus must be executable",
      "description": "Executable permission is required for KDE service-menu files.",
      "tags": ["kde", "permissions"],
      "evidenceRefs": ["evidence-3"],
      "content": {
        "symptom": "KDE reports that the service menu is not authorized.",
        "cause": "The desktop file has mode 0644.",
        "fix": "Mark the desktop file executable.",
        "validation": "Retry the service menu without rebooting."
      }
    }
  ]
}
```

Type-specific content:

- `Decision`: `answer`, `rationale`, and optional `rejectedAlternative`.
- `Gotcha`: `symptom`, `cause`, `fix`, and optional `validation`.
- `Runbook`: `purpose`, ordered `steps`, and optional `validation`.

Rules:

- `action` is `create` or `update`.
- `targetConceptId` is required for `update` and forbidden for `create`.
- Every evidence reference must name a message, checkpoint, or tool evidence item in the packet.
- An empty `concepts` list is valid.
- The model never invents IDs, filenames, timestamps, status, verification, or source resources.
- The model may update only the packet's current full-content update candidate.
- An update type must match the target type.
- One response may update a target at most once.
- Every concept must reference at least one evidence item.

Parse and validate the full response. Retry once with the validation errors when parsing or schema validation fails. Report and skip the packet after the second failure.

Inspect only assistant messages produced by the current prompt attempt. Require `stopReason: "stop"` before parsing. Treat `error`, `aborted`, missing, and transport outcomes as non-terminal input failures.

Do not persist full packets, raw model responses, or unredacted excerpts.
The application derives `sources[].id` and `sources[].resource` from selected evidence items. The model cannot supply provenance.

### Stage 5: Apply concepts

Before applying an operation, validate every target path, application ID, target type, and evidence reference. Reject duplicate application IDs and duplicate target updates. Apply the recorded file bytes idempotently.

For `create`:

- Generate a random application ID with sufficient collision resistance.
- Create `concepts/<concept-id>.md`.
- Set `status: draft`.
- Set `generated.by` to `cheatcodes/<version>`.
- Set `generated.at` to the creation time.
- Generate source IDs and resources from session and record identity.

For `update`:

- Resolve the target by application ID.
- Require the operation's expected target hash to match.
- Keep the existing path, application ID, title, description, and prior body.
- Union tags and application-generated sources.
- Preserve `status`, `verified`, unknown frontmatter keys, and unowned body sections.
- Append only evidence-backed new content under a generated `# Updates` section.
- Skip an exact duplicate addendum.
- Reject automatic changes to a `stable`, `deprecated`, or verified concept with a warning.
- Change `generated.at` only when the additive content or provenance changes.

The renderer creates consistent body headings for each concept type. It renders cited evidence excerpts under `# Evidence`. It never asks the model to write YAML or Markdown structure.

Use a source resource such as `session:<session-id>#entries=<id-list>`. The resource is a source descriptor for the MVP. Portable evidence excerpts remain deferred.

Humans may change lifecycle fields in curated frontmatter. A human review should set both `status: stable` and `verified: { by: human:<id>, at: <time> }`.

When a human changes concept content, that human must update `generated.by` and `generated.at`. A lifecycle-only review does not change generation metadata.

Humans should finish content edits before marking a concept stable. Automatic updates do not overwrite stable or verified content.

### Stage 6: Publish

- Parse and validate every curated Markdown file.
- Require a non-empty `type`, `cheatcodes_id`, title, description, status, and generated actor.
- Restrict `status` to `draft`, `stable`, or `deprecated`.
- Require a non-empty `sources` list and validate every `sources[].resource`.
- Validate `generated` and optional `stale_after` values.
- Accept and normalize either the mapping or list form of `verified`.
- Preserve producer-defined frontmatter keys during round-trips.
- Copy each validated concept to the same relative path under `knowledge/`.
- Generate `concepts/index.md` from concept frontmatter and group entries by type.
- Generate the root index with `okf_version: "0.2"`.
- Link the root index to `concepts/` for three-level progressive disclosure.
- Sort type groups by the fixed MVP type order.
- Sort concepts by normalized title and then path.
- Include status in each index entry so drafts remain visible as drafts.
- Preserve `generated.at` from curated files.
- Do not use publish time in generated output.
- Compare the rendered tree with the current bundle and stop when their bytes match.
- Under the project lock, rename the old bundle to a backup, move the complete temporary tree into place, and then remove the backup.
- On startup, recover a leftover backup before publishing again.

## 8. Pi SDK integration

Use one runtime, one in-memory settings manager, and one isolated loader per command run.

```typescript
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const resolved = resolveCliModel({
  cliModel: config.model,
  modelRuntime,
});

if (resolved.error || !resolved.model) {
  throw new Error(resolved.error ?? `Model not found: ${config.model}`);
}
if (resolved.warning) throw new Error(resolved.warning);

This integration supports built-in catalogs and custom providers declared in `~/.pi/agent/models.json`. It does not load extension-registered providers.

const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: false },
});

const loader = new DefaultResourceLoader({
  cwd: projectRoot,
  agentDir: getAgentDir(),
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  systemPrompt: CURATOR_PROMPT,
  appendSystemPrompt: [],
  settingsManager,
});
await loader.reload();

async function curate(packetText: string): Promise<string> {
  const { session } = await createAgentSession({
    cwd: projectRoot,
    model: resolved.model,
    thinkingLevel: resolved.thinkingLevel ?? "medium",
    noTools: "all",
    sessionManager: SessionManager.inMemory(projectRoot),
    resourceLoader: loader,
    modelRuntime,
    settingsManager,
  });

  try {
    const messageStart = session.messages.length;
    await session.prompt(packetText);
    return readFinalAssistantText(session.messages.slice(messageStart));
  } finally {
    session.dispose();
  }
}
```

`readFinalAssistantText()` requires the last new message to be an assistant message with `stopReason: "stop"`. It concatenates only text blocks. It reports other stop reasons as model failures.

## 9. Commands

```text
cheatcodes init --model <provider/model[:thinking]> --input <folder>
cheatcodes run
cheatcodes publish
cheatcodes status
```

Command behavior:

- `init` writes config, creates canonical directories, and adds one managed pointer to Pi's active project context file.
- Repeated `init` does not duplicate the pointer.
- When `AGENTS.override.md` exists, `init` updates it instead of `AGENTS.md`.
- When no context file exists, `init` creates `AGENTS.md`.
- `run` acquires the project lock, discovers changes, curates new episodes, commits state, and publishes.
- `publish` acquires the project lock and rebuilds `knowledge/` without creating a model runtime.
- `status` reports input cursors, skipped files, draft counts, and stable counts without creating a model runtime.

The managed project-context text is:

```markdown
## Project knowledge

Start with `.cheatcodes/knowledge/index.md`. Check concept status before relying on a draft.
```

## 10. Module layout

```text
src/
├── cli.ts          # argument parsing and command dispatch
├── config.ts       # config schema, init, and project-root resolution
├── state.ts        # cursors, atomic state writes, and transient operations
├── scan.ts         # input discovery, stat diff, and header filtering
├── jsonl.ts        # streaming parse, prefix hash, branch graph, and receipts
├── harvest.ts      # segmentation, detectors, shortlist, and packet rendering
├── curate.ts       # Pi SDK lifecycle, response parsing, and one retry
├── concept.ts      # canonical frontmatter, IDs, merge rules, and Markdown rendering
└── publish.ts      # temporary OKF tree and deterministic indexes
```

Keep schemas beside the modules that own them. Export concept parsing from `concept.ts` for `publish.ts`. Do not add a generic utility module until code is actually shared.

Inject a `Curator` interface into the pipeline. Production uses the Pi SDK implementation. Tests use a deterministic fake.

## 11. Implementation order

1. Create the CLI scaffold, config schema, state schema, transient operation journal, and `init` command.
2. Implement discovery, project filtering, prefix hashing, and complete-line cursor handling.
3. Implement v1 linear parsing and v2 or v3 parent-graph parsing.
4. Implement compact receipts, validation classification, and redaction.
5. Implement segmentation, high-signal detectors, packet IDs, and related-concept shortlisting.
6. Implement canonical concept creation, full-context additive updates, mutation replay, YAML handling, and Markdown rendering.
7. Implement deterministic `publish` with temporary-tree replacement and indexes.
8. Implement the Pi SDK curator and strict response validation.
9. Wire `run`, `publish`, and `status`.
10. Add hermetic fixtures and the opt-in live-model smoke test.

## 12. Acceptance tests

Required tests use a fake curator and temporary directories.

1. `init` writes valid config and adds the pointer to the active project context file once.
2. `init` generates a persistent `projectId` when no Git remote exists.
3. `run` with no matching inputs exits cleanly without constructing a model runtime.
4. A first run over a linear fixture creates curated drafts and a conformant knowledge tree.
5. Existing v1 synthetic record IDs remain unchanged after an append.
6. An immediate second run makes zero curator calls and changes no files.
7. Appending records sends only packets that contain at least one appended record.
8. A tool call before the old cursor can pair with a tool result after the cursor.
9. A partial final JSON line remains unprocessed until a newline completes it.
10. The parser never forms one failure-to-success episode from sibling branches.
11. Shared branch prefixes produce only one packet ID and one curator call.
12. The prefix digest detects and reprocesses a same-path rewrite.
13. A malformed complete line warns without exposing its contents.
14. A masked or ambiguous shell exit does not confirm validation by itself.
15. Assistant decision language without acceptance or implementation evidence produces no Decision.
16. A correction without tool calls can cite deterministic message evidence.
17. A crash after operation creation replays the same concept bytes and application ID without another model call.
18. An update replay stops when the target hash matches neither the expected nor intended hash.
19. A second writer cannot acquire the project mutation lock.
20. An interrupted publish recovers its backup before a later publish.
21. Deleting `knowledge/` and running `publish` produces the same tree hash.
22. Deleting `knowledge/` and running `run` rebuilds it without any curator calls.
23. LLM changes to type, title, or description cannot rename an existing concept or change its application ID.
24. A draft update receives the current target and appends content without changing prior or unowned sections.
25. Two packets targeting one draft receive sequentially refreshed target content.
26. An update to a stable or verified concept is rejected without changing the file.
27. Invalid JSON or schema output retries once, records a no-op outcome, and advances with a packet-ID warning.
28. An assistant `error` or `aborted` stop reason does not advance the input cursor.
29. A secret fixture does not appear in model packets, operations, curated files, or the bundle.
30. Project-root aliases normalize the same relative path to one `repo://` identity.
31. The isolated SDK loader has no append prompt, context files, extensions, or persisted settings.
32. The publisher preserves unknown frontmatter and accepts both valid `verified` forms.
33. The root index declares OKF v0.2 and `concepts/index.md` has no frontmatter.
34. A custom provider from an isolated `models.json` fixture resolves through `resolveCliModel()`.
35. A model-resolution fallback warning fails before the first model call.

Add one opt-in smoke test for a real configured model. Exclude that test from the required local and CI suites.

## 13. Risks and limits

- Deterministic shortlisting can still miss semantic duplicates. Draft status and stable-update protection limit the damage.
- Full deterministic scans can become slow on very large changed files. Add a persisted normalized ledger only after measurement proves it necessary.
- Basic redaction cannot guarantee complete secret detection. Keep packet inputs narrow and never persist packets or raw responses.
- A rewritten or deleted session can leave an old concept behind. Report rewritten sources and defer automatic retraction.
- Session source descriptors are not portable evidence. Add narrow `references/sessions/` excerpts after the core workflow proves useful.
- Header-only project scoping can include unrelated work from a session that starts inside the repository. Add episode-level scope detection only after real false positives appear.
- Model output can be malformed or unsupported by evidence. Strict schemas, evidence-reference validation, and one retry limit this risk.
- Auto-updates stop after human verification. A future review workflow can present proposed changes without overwriting reviewed knowledge.

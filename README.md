# Cheatcodes

> **Make the project remember what its sessions learn.**
>
> Cheatcodes turns hard-won lessons from coding-agent sessions into durable project knowledge.

Coding sessions produce useful knowledge all the time.

A failed approach reveals a hidden constraint.

A user correction clarifies something the repository never says outright.

A difficult bug exposes a recovery procedure.

A design discussion settles why one option is preferred over another.

Then the session ends.

Without somewhere for those lessons to go, the next agent gets to learn them again.

## Don't pay twice for the same lesson

Agent context is temporary.

That is usually a good thing. Most of a coding session is working state: searches, intermediate reasoning, failed commands, partial ideas, and details that mattered only while solving one problem.

Keeping all of it would create more noise than memory.

But buried inside that temporary context are sometimes lessons the project should keep.

Cheatcodes looks for those moments and asks a stricter question:

> **Will knowing this save a future agent from having to rediscover something important?**

If the answer is yes, the lesson can become project knowledge.

If the repository already makes it obvious, it stays out.

If the evidence is incomplete, it stays out.

If it is just a test count, progress update, or implementation detail, it stays out.

An empty knowledge file is better than a large one full of things the agent could have figured out anyway.

## Keep the lesson, not the transcript

Cheatcodes does not turn sessions into summaries.

It turns evidence into current guidance.

```text id="gft5nw"
session

  failed approach
       |
  user correction
       |
  successful fix
       |
  validation
       v

 bounded evidence
       |
       v
    curate
       |
       v

"Batch exports by fiscal quarter
 before reconciliation."
```

The raw back-and-forth is useful while solving the problem.

The durable lesson is what matters next time.

That distinction keeps the knowledge file small enough to remain useful.

## What is worth remembering?

Cheatcodes is deliberately conservative.

Good project knowledge tends to be things like:

* non-obvious project constraints
* decisions and the reasons behind them
* failure modes with a verified recovery
* project-specific gotchas
* procedures that were actually validated
* invariants that are easy to violate but hard to infer

A lesson needs more than confident language.

A correction can nominate something for review, but does not make it true by itself.

A failed approach is not a lesson until the recovery actually succeeds.

And if the answer is already sitting plainly in the code or documentation, there is little value in copying it into another file.

The knowledge file is for the things that are expensive to reconstruct.

## Project knowledge should describe now

Session logs are chronological.

Project guidance should not be.

If a later session improves an existing lesson, Cheatcodes updates the guidance instead of appending another historical note underneath it.

The result should read like:

> Use the repository adapter for persistence because direct database access bypasses the transaction boundary.

not:

> On Tuesday the agent tried direct database access, then the user corrected it, then...

History produced the lesson.

Future agents need the lesson.

## Knowledge has to be found to be useful

Writing down project knowledge does not guarantee an agent will use it.

A useful lesson can sit untouched in a file because the next session does not know it exists or does not think to look there.

Cheatcodes keeps the knowledge file at:

```text id="5gtuh2"
.agents/CHEATCODES.md
```

and, by default, adds a small pointer from the project's agent instructions:

```text id="iqj51h"
## Project knowledge

Start with `.agents/CHEATCODES.md`.
```

It also provides bounded knowledge search when the agent needs to recall something specific.

The goal is to make lessons available to the next session at the point where they can change what the agent does.

## Plain Markdown on purpose

The durable memory is just Markdown beside the code.

```text id="w9xb1h"
project/
├── src/
├── ...
├── AGENTS.md
└── .agents/
    └── CHEATCODES.md
```

There is no server or database required to read it.

You can:

* commit it
* review changes in Git
* edit an entry
* delete bad guidance
* read it yourself
* let another tool consume it

The curation machinery can be sophisticated without making the memory format proprietary.

If Cheatcodes disappears tomorrow, the knowledge stays.

## It learns as the project works

Once configured, Cheatcodes runs automatically when Pi sessions start in trusted projects.

It processes new or changed session material rather than repeatedly curating the entire history.

That means project knowledge can improve as normal work happens:

```text id="pza0ra"
work
  |
learn something expensive
  |
session settles
  |
Cheatcodes reviews the lesson
  |
.agents/CHEATCODES.md improves
  |
future session starts smarter
```

You do not need to summarize each session yourself.

## The project map

Some useful knowledge does not come from a session at all.

It comes from understanding how several parts of the repository fit together.

That understanding can also be expensive to rebuild repeatedly.

Cheatcodes can optionally synthesize a project map:

```bash id="2xjs5m"
cheatcodes map
```

The map is not meant to restate the README or catalog files.

It records cross-file understanding that a new engineer actually needs: what the project does, how major pieces fit together, and capabilities that change the mental model of the system.

A point is only worth caching when it synthesizes information spread across multiple files.

If one file already explains it well, that file remains the source of truth.

## Working with Snoop

Cheatcodes was designed as a complementary to Snoop.

Cheatcodes decides what future sessions should know and writes it down.

Snoop makes what the repository already contains findable again.

Snoop indexes current code, Markdown, Git history, and prior Pi sessions. It also has custom chunking strategy for CHEATCODES.md file. When an agent needs to know why the code looks the way it does, Snoop can recall the commit, the design note, the earlier session that explains it, along with any relevent curated cheatcode entries.

The knowledge file is part of that index. Because it is plain Markdown, Snoop treats it like any other document, so a curated lesson can surface right next to the evidence that produced it.

The division of labor:

* Cheatcodes records what the project learned.
* Snoop recalls everything else, including the history behind each lesson.

Each covers the other's gap.

Snoop is retroactive. A lesson that never made it into the knowledge file stays recoverable through the commits and sessions that produced it.

Cheatcodes is selective. The knowledge file stays small, which is what keeps retrieval useful.

Both stay local. Cheatcodes writes Markdown beside the code, and Snoop keeps its index in SQLite.

> **Cheatcodes writes the lesson. Snoop finds it again.**

## Without Snoop

Snoop indexes the knowledge file along with everything else.

Without it, the agent has to know the file exists and think to look.

Cheatcodes already adds a minimal pointer to `AGENTS.md`:

```text id="k8sm4q"
## Project knowledge

Start with `.agents/CHEATCODES.md`.
```

That says where the knowledge lives. It does not say when to consult it or why it matters.

One stronger line can:

```text id="m4qt7x"
Before working on anything non-obvious, check `.agents/CHEATCODES.md` or call `search_knowledge`; past sessions left decisions, constraints, and failure modes there.
```

## Install

Install Cheatcodes as a Pi package:

```bash id="hn9p97"
pi install git:github.com/sij0sh/cheatcodes
```

Then create:

```text id="cqxn3n"
~/.config/cheatcodes/config.json
```

with the model you want to use for curation:

```json id="fnlkmg"
{
  "version": 2,
  "model": "provider/model",
  "inputs": [],
  "workerTimeoutMinutes": 10,
  "projectAliases": {}
}
```

An empty `inputs` list uses the normal Pi session directory when available.

After that, work in Pi normally.

Cheatcodes starts its freshness pass automatically when a session begins in a trusted project.

The first useful lesson creates the knowledge file and its pointer in the agent instructions.

## The curator model

Cheatcodes needs a model to judge whether session evidence deserves to become durable knowledge.

Set:

```json id="lrr38i"
"model": "provider/model"
```

to a model available through a Pi-compatible model registry.

When Cheatcodes first needs its model registry, it can copy Pi's existing registry if available.

The curator sees bounded evidence rather than entire session histories.

Common secret formats are redacted before that evidence reaches the model.

## Running the map

Repository synthesis is intentionally separate from normal session curation because it spends model effort inspecting the repository itself.

Run it when you want to cache that broader mental model:

```bash id="ll669n"
cheatcodes map
```

The resulting entries live in the same knowledge file.

Cheatcodes can cheaply detect when map sources have changed. Regenerating the map remains opt-in unless `autoMap` is enabled.

## Configuration

Most projects only need to choose a curator model.

Additional controls are available when needed:

| Field                  | Purpose                                        | Default                 |
| ---------------------- | ---------------------------------------------- | ----------------------- |
| `model`                | Model used for curation                        | required                |
| `inputs`               | Additional session locations                   | Pi sessions             |
| `workerTimeoutMinutes` | Maximum curation run time                      | `10`                    |
| `knowledgeFile`        | Project knowledge path                         | `.agents/CHEATCODES.md` |
| `contextPointer`       | Point agent instructions at the knowledge file | `true`                  |
| `autorun`              | Curate automatically on Pi session start       | `true`                  |
| `tools`                | Expose project knowledge search in Pi          | `true`                  |
| `autoMap`              | Resynthesize a stale project map automatically | `false`                 |
| `projectAliases`       | Treat other paths as the same project          | `{}`                    |

## Standalone CLI

Cheatcodes can also be installed without Pi:

```bash id="qklcdt"
npm install -g github:sij0sh/cheatcodes
```

Administrative commands include:

```bash id="th8li0"
cheatcodes status
cheatcodes run
cheatcodes map
cheatcodes maintain
```

Normal Pi use does not require running them after every session.

## Why Cheatcodes?

Longer context windows do not solve institutional memory.

Neither does saving every transcript.

The useful middle ground is to let temporary reasoning disappear while preserving the few lessons that should change future behavior.

> **Sessions are disposable. Lessons do not have to be.**

Cheatcodes gives those lessons somewhere simple to live, and gives the next agent a way to find them before it learns the same thing the hard way.

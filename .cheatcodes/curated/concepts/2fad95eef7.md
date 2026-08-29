---
cheatcodes_id: 2fad95eef7
type: Decision
title: Use global configuration with an optionless automatic entry point
description: Store user settings globally and give launchers a stable command that checks, initializes, and runs Cheatcodes for a repository.
tags:
  - configuration
  - global-settings
  - cli
  - migration
  - pi-extension
status: draft
generated:
  by: cheatcodes/0.2.0
  at: 2026-08-29T18:39:05.212Z
sources:
  - id: session-6312cc6cc0be5460
    resource: session:01a04b3e-3031-7d12-a443-adff4f9e320a#entries=6014e840,ff206fac,fce45fec,baaafbe6
    title: Session evidence
---

# Answer

Move user settings to ~/.config/cheatcodes/config.json, keep only project identity and durable knowledge in repositories, and add an optionless cheatcodes auto command for Pi or other launchers. By default, auto should initialize and run in trusted Git repositories when Cheatcodes is absent.

# Why

Global settings avoid per-repository duplication, while a single automatic entry point keeps the Pi shim simple. Existing repository configuration and state must be migrated without data loss so the boundary change does not discard project knowledge.

# Evidence

- [evidence-05eb61361e1e4f18c59eaa28] Analyze this project along with: [ABSOLUTE PATH]
I want to keep the two boundari
[truncated]
- [evidence-2e3028ecd05401c9aef4ed40] read | repo://local:e42d44d0-d178-4740-abe7-70c716483ba0/src/cli.ts | 5660f5d95e
[truncated]
- [evidence-edbf3c2a31f5a27992df1b03] read | repo://local:e42d44d0-d178-4740-abe7-70c716483ba0/src/config.ts | 7451ab2
[truncated]
- [evidence-0de52dcd134d0fa3500465c6] read | repo://local:e42d44d0-d178-4740-abe7-70c716483ba0/src/state.ts | 8f58970d
[truncated]

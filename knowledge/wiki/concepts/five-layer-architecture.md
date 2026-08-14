---
title: The 5-layer architecture
domain: codebase
created: 2026-08-07
updated: 2026-08-07
tags: [architecture, layers, boundaries]
sources: [ARCHITECTURE.md, .claude/CLAUDE.md, .claude/rules/commands-layer.md, .claude/rules/execution-layer.md]
status: active
---

The CLI is organized into five layers; imports flow top-down only (layer N may
import from 1..N-1, never N+1 — enforced by `dependency-cruiser`).

| Layer | Dir | Responsibility |
|---|---|---|
| 5 | `05-shells/` | commands (operations + utilities) + REPL entry |
| 4 | `04-pipeline/` | resolve → execute → output (+ wizard runner) |
| 3 | `03-definitions/` | param-surface + flows (declarative, no I/O) |
| 2 | `02-services/` | auth, HTTP, SDK client, persistence |
| 1 | `01-infrastructure/` | errors, flags, ui-core, ui, utils |

Every operation command is a one-liner built by the factory at
`05-shells/01-command-builder/builder.ts`, which owns the full
resolve→execute→output pipeline. Dependencies are passed explicitly (no
singletons) and narrowed per layer (`CliDeps` → `ExecutionDeps` → `OutputDeps`).

## Related
- [[overview]]
- [[ai-client]]

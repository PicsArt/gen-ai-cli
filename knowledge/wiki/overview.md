---
title: gen-ai CLI — knowledge base overview
domain: codebase
created: 2026-08-07
updated: 2026-08-07
tags: [overview, entry-point]
sources: [ARCHITECTURE.md, .claude/CLAUDE.md]
status: active
---

Synthesis entry point for the `@picsart/gen-ai` CLI knowledge base. Three
domains are tracked here:

- **codebase** — architecture and how the CLI is built. Start at
  [[five-layer-architecture]] and [[ai-client]].
- **product** — models, operations, flags, SDK behavior. (Grows via ingest of
  `docs/` and SDK sources.)
- **roadmap** — planned work and tech debt: [[tech-debt-backlog]].

The CLI is a 5-layer, declarative-flow architecture. Generation operations are
one-liners produced by a command factory; the param surface is derived from the
SDK's `paramConfig` descriptors. See `ARCHITECTURE.md` for the full tree.

## Related
- [[five-layer-architecture]]
- [[ai-client]]
- [[tech-debt-backlog]]

---
title: getAiClient() — the single SDK client
domain: codebase
created: 2026-08-07
updated: 2026-08-07
tags: [services, sdk, client, singleton-entry]
sources: [src/02-services/client.ts, .claude/CLAUDE.md]
status: active
---

`getAiClient()` in `src/02-services/client.ts` is the **only** `createClient()`
call in the CLI (hard rule: "One SDK client"). Drive access, file upload, and
generation all route through this single client instance. It lives in layer 2
(`02-services`), so layers 3–5 reach the SDK exclusively through it rather than
constructing their own clients.

This is why `getAuthenticatedFetch()` is a single entry point in the operation
factory pipeline — auth and transport converge on one client.

## Related
- [[five-layer-architecture]]
- [[overview]]

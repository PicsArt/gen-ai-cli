---
paths:
  - "src/output/**/*.ts"
---

# Output layer rules

Handles everything after execution returns a result.

- Can import from `shared/ui-core/` (needs card rendering) but not `shared/ui/` (no prompts)
- Cannot import from `execution/`, `commands/`, `resolvers/`, or `entry/`
- Never create SDK clients — receive `DriveContext` from the command layer
- Non-critical failures (Drive save, download) are warnings, not thrown errors
- Always record to history, even on failure/cancellation
- Use `OutputDeps` (color, out, authenticatedFetch, uploadUrl) — passed explicitly

---
paths:
  - "src/execution/**/*.ts"
---

# Execution layer rules

This layer is pure logic — zero UI.

- Do not import from `shared/ui/`, `shared/ui-core/`, `entry/`, `commands/`, `resolvers/`, or `output/`
- Do not access `ColorManager`, `OutputManager`, or write to stdout/stderr
- Report progress via `ProgressCallback`, not console output
- Token refresh is silent — no info messages to the user
- Throw typed `CliError` subclasses (`AuthError`, `ApiError`, `NetworkError`), never raw `Error`
- `ExecutionDeps` has only `apiUrl`, `uploadUrl`, `authenticatedFetch` — no UI fields

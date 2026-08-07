---
paths:
  - "src/commands/**/*.ts"
---

# Commands layer rules

Commands are thin orchestrators — they connect layers, not implement logic.

- `run()` should follow the pipeline: resolve → execute → handle output
- Apply user config defaults via `buildOutputConfig()` before the pipeline
- Build `DriveContext` in the command, pass to output layer — don't let output create SDK clients
- Handle `InsufficientCreditsError` with `handleCreditsError()` (interactive recovery)
- Use `createProgressHandler()` for spinner updates from execution progress callbacks
- Shared flags: compose `baseFlags`, `outputFlags`, `modelFlags` from `shared/flags/`
- Helpers in `commands/helpers/` are command-layer concerns, not shared modules

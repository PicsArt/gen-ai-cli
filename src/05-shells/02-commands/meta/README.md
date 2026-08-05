# `02-commands/meta/`

Meta-commands — they orchestrate other commands rather than running a model directly.

| Command | Wraps | What it does |
|---|---|---|
| `extend` | `gen-ai generate` (any VEO model) | Extends a video by +7 seconds. With `--times N` it loops N times, feeding each result back as the next input. ffprobe is used opportunistically to auto-detect aspect ratio from local files; without it, pass `--ar` / `--aspect-ratio`. |
| `redo` | `gen-ai generate` | Re-runs the last entry from `02-services/history.ts` with optional per-flag overrides (`--prompt`, `--model`, `--ar`, `--duration`, etc.). |

## Why a separate folder

`02-commands/operations/` is reserved for the 21 one-liner files that just do `createOperationCommand(FLOWS['<id>'])`. Those are pure operations: one user invocation → one model call → one result.

Meta-commands break that contract:

- `extend --times 3` produces THREE generations from one invocation.
- `redo` produces zero or one — depending on whether history is empty.

Putting them in `operations/` would lie about that shape. Putting them under `meta/` makes the chain-wrapper category visible in the source tree.

## Status

Bespoke implementations today. If a future pattern emerges (e.g. multi-step pipelines with a shared declarative spec), the factory in `01-command-builder/` could grow to support it. Until then, each file in `meta/` is hand-written.

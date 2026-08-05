# 04-output — Result Handling

Consumes an `ExecutionResult` and does everything a user can see or save: terminal display, local download, Drive save, history, and extras.

## Responsibility

Single entry point `handleOutput(result, config, deps, driveCtx?)` runs this fixed pipeline:

```
display → download → drive save → history → extras (clipboard, open, bell, notify)
```

Each step is independent; failures in non-critical steps (Drive, download) become warnings, not thrown errors. The user gets their output even if the convenience side-effects fail.

## Public surface

```ts
handleOutput(result, outputConfig, deps, driveCtx?) → Promise<void>
```

`deps` is `OutputDeps` (UI permitted, executor + resolver not). `driveCtx` is built by `05-shells/02-commands/helpers/build-drive-context.ts` when Drive save is enabled.

## Internal pieces

| File | What it does |
|---|---|
| `handle.ts`        | Orchestrator — calls everything below in order |
| `display.ts`       | Terminal output: branded card / JSON / quiet (URL only) / plain |
| `download.ts`      | Save result file(s) to a local directory |
| `drive.ts`         | Upload result to Picsart Drive |
| `drive-save.ts`    | Smart filename + rich attributes (uses an LLM callback) |
| `extras.ts`        | Clipboard, open in app, terminal bell, desktop notification |
| `video-preview.ts` | First-frame thumbnail via ffmpeg + CDN upload (best-effort) |

## What this block does NOT do

- Talk to the model SDK — that's `03-execution/`.
- Touch input files — those have already been uploaded and consumed.
- Decide how the user is authenticated — `driveCtx` arrives pre-built.

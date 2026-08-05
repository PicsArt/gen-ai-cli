# 01-command-builder — Operation Command Factory

Turns a `FlowSpec` into a full oclif `Command` class. Every operation command file under `02-commands/operations/` collapses to a single line:

```ts
import { createOperationCommand } from '#shell/command-builder';
import { FLOWS } from '#flows';
export default createOperationCommand(FLOWS['<id>']);
```

## Public surface

```ts
createOperationCommand(flow: FlowSpec): typeof Command
runOperation(flow, flags, deps): Promise<void>   // pure pipeline (testable)
```

`createOperationCommand` is a thin oclif wrapper around `runOperation`. The wrapper sets `static summary`, `static examples`, and `static flags` (via `composeFlagsForFlow(flow, getCatalog(), Models.list())`), then delegates `run()` to `runOperation`.

`runOperation` is the entire orchestration as a pure async function — fully unit-tested without standing up oclif.

## The pipeline (owned exclusively here)

1. `buildOutputConfig(flags, userConfig, modeFlags)`
2. `resolveInputs(flow, flags, deps)` — interactive wizard or scripted resolver
3. `getAuthenticatedFetch()` — single SDK client entry
4. `buildDriveContext(...)` (only when `outputConfig.driveSave` is true)
5. Spinner + SIGINT abort wiring
6. `execute(inputs, deps, options)` — sync/async SDK routing
7. `handleOutput(result, outputConfig, outDeps, driveCtx?)`
8. Friendly `InsufficientCreditsError` handling (offers billing URL)

Operation command files MUST NOT reimplement or wrap any of these steps. If a command needs behavior outside this pipeline, it isn't an operation command — it belongs in `02-commands/utilities/`.

## Files

| File | Role |
|---|---|
| `builder.ts` | `runOperation` (pure) + `createOperationCommand` (oclif wrapper) |
| `helpers/build-output-config.ts` | Flags + userConfig → `OutputConfig` |
| `helpers/build-drive-context.ts` | Resolve Drive folder uid + wire save / runCompletion closures |
| `helpers/handle-credits-error.ts` | `isCreditsError`, `handleCreditsError` (billing prompt) |
| `helpers/render-progress.ts` | `createProgressHandler` (spinner text updater) |

All helpers are private to this block — they live here, not under `02-commands/`, so the boundary is clear: helpers are builder internals.

## What this block does NOT do

- Define flows (that's `03-definitions/02-flows/`).
- Compose flags or wizard steps from a flow (that's `03-definitions/02-flows/03-compose/`).
- Run the pipeline stages (those are `04-pipeline/02-resolve`, `03-execution`, `04-output`).
- Handle utility commands like `login`, `models`, `config`, `history` — those are not operations and don't use this builder.

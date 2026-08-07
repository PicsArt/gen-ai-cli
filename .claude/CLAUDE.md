# gen-ai CLI package

Architecture: @ARCHITECTURE.md · Visual: `CLI_ARCHITECTURE_VISUAL.html`

## Hard rules

- **No singletons.** Never call `getColor()` or `getOutput()`. Pass deps explicitly. Enforced by `scripts/check-no-singletons.sh`.
- **No raw errors.** Use `UsageError`, `AuthError`, `ApiError`, `ValidationError`, `InsufficientCreditsError`, `FileError`, `NetworkError` — never `throw new Error(...)`. Enforced by `scripts/check-typed-errors.sh`.
- **Max 600 lines per file.** Extract sub-modules when approaching. Pre-commit enforced.
- **Biome, not ESLint**. Run `npm run lint` before committing.
- **No `any` types.** Biome strict mode rejects `noExplicitAny`.
- **Top-down imports only.** Layer N may import from layers 1..N-1, never N+1. Enforced by `dependency-cruiser`.
- **One SDK client.** `getAiClient()` in `src/02-services/client.ts` is the only `createClient()` call. Drive, file upload, generation all route through it.

## The 5 layers

```
05-shells/        commands (operations + utilities) + REPL entry
04-pipeline/      resolve → execute → output (+ wizard runner)
03-definitions/   01-param-surface + 02-flows (declarative, no I/O)
02-services/      auth, HTTP, SDK client, persistence
01-infrastructure/ errors, flags, ui-core, ui, utils
```

Full block-by-block tree, exports, and import matrix: see `ARCHITECTURE.md`.

## Dependency passing

`BaseCommand.init()` creates `this.deps` (`CliDeps`). Layers receive narrowed subsets:

| Layer | Type | Narrower than CliDeps because |
|---|---|---|
| Commands | `CliDeps` | full color + out + config + flags |
| Execution | `ExecutionDeps` via `toExecutionDeps()` | no UI fields (enforces no-direct-print) |
| Output | `OutputDeps` via `toOutputDeps()` | has UI, no resolver state |
| Drive save | `DriveContext` | built by `01-command-builder/helpers/build-drive-context.ts` |

## Operation command pattern

**Every operation command is a one-liner.** The factory at `05-shells/01-command-builder/builder.ts` owns the full pipeline.

```ts
// src/05-shells/02-commands/operations/<id>.ts
import { FLOWS } from '#flows';
import { createOperationCommand } from '../../01-command-builder/builder.ts';
export default createOperationCommand(FLOWS['<id>']);
```

The factory's pipeline (do NOT re-implement in command files):

1. `buildOutputConfig(flags, userConfig, modeFlags)`
2. `resolveInputs(flow, flags, deps)` — interactive wizard or scripted, then `resolveAllFiles` to upload local paths
3. `getAuthenticatedFetch()` — single SDK-client entry
4. `buildDriveContext(...)` (only when `outputConfig.driveSave`)
5. Spinner + `SIGINT` abort wiring
6. `execute(inputs, deps, options)` — sync/async SDK routing
7. `handleOutput(result, config, outDeps, driveCtx?)`
8. Friendly `InsufficientCreditsError` handling (offers billing link)

If a command needs behavior outside this pipeline, it's a **utility command** — it goes in `02-commands/<group>/` or top-level `02-commands/`, NOT in `operations/`.

## Adding a new operation

1. Create a FlowSpec at `src/03-definitions/02-flows/02-registry/02-flows/NN-<id>/<id>.ts`:
   ```ts
   export const FOO_FLOW = defineFlow({
     id: 'foo',
     description: '…',
     modelFilter: (m) => m.inputType === '…' && m.disabled !== true,
     requiredInputs: ['prompt', 'image'],
     staticFlagGroups: ['universal', 'output', 'model', 'prompt-input'],
     staticStepGroups: ['output', 'confirm'],
     examples: [...],
   });
   ```
2. Register it in `_flows.ts` (the `FLOWS` map).
3. Create the one-liner command at `src/05-shells/02-commands/operations/<id>.ts`.
4. Register the Command class in `src/commands-manifest.ts`.

That's it. No flag-spreading, no `run()` body, no pipeline glue.

## Adding a new generation flag (`--foo`)

The CLI exposes what the SDK already publishes — never edit `specs/src/` to satisfy a CLI need. Only fields the SDK declares as `paramConfig` descriptors can become CLI flags.

1. Check `specs/src/vendors/catalog/*.ts` — does the model's `paramConfig` declare a descriptor for `foo`?
   - **No** → file a gap in `playgroundwiki/sdk/coverage-gaps.md`. Stop.
   - **Yes** → the descriptor automatically becomes a `--foo` flag via Param Surface. No CLI file edits needed for the flag itself.
2. If you want a short alias (`-x`), add it to `ALIAS_MAP` in `src/03-definitions/01-param-surface/01-primitives/01-aliases/aliases.ts`.
3. Update `playgroundwiki/cli/cli-spec.md` flag table + add a `playgroundwiki/LOG.md` entry.

The interactive wizard reads the same `paramConfig` descriptors, so scripted and interactive paths stay in sync automatically.

## Adding a new STATIC flag (no SDK descriptor)

Goes in `src/03-definitions/02-flows/01-static/01-static-flags/static-flags.ts`. Existing groups: `universal`, `output`, `model`, `prompt-input`. Flows opt in via their `staticFlagGroups` list.

## Pre-commit checks (all must pass)

1. `eslint --fix` + `tsc --noEmit` (root config, all staged TS)
2. `biome check` (staged files)
3. `depcruise src/` (architecture boundaries)
4. `scripts/check-file-size.sh` (600-line limit)
5. `scripts/check-typed-errors.sh` (no raw `Error` in layers)
6. `scripts/check-no-singletons.sh` (no `getColor()`/`getOutput()`)

`--no-verify` is not allowed. If a hook blocks, fix the underlying issue.

## Testing

- **Vitest** with co-located `<name>.test.ts` next to every `<name>.ts` under `src/01-…05-…`.
- Run all: `npx vitest run`. Run one block: `npx vitest run src/04-pipeline/02-resolve`.
- Mock upstream modules at the boundary with `vi.mock(...)` + `vi.hoisted(() => vi.fn())`.
- The legacy node-runner at `__tests__/run-all.ts` only covers a few integration suites; new tests go co-located.

## Key types

Defined in `src/types.ts` and `src/deps.ts`:

| Type | Purpose |
|---|---|
| `ResolvedInputs` | `{ model, params, files }` — resolver output. `files` slots are URLs by here. |
| `ExecutionResult` | `{ status, url?, results[], model, params, durationMs, error? }` |
| `OutputConfig` | Download / Drive / clipboard / open / bell / notify / mode flags |
| `FlowSpec` | The declarative command shape — replaces the legacy `OperationConfig` |
| `CliDeps` / `ExecutionDeps` / `OutputDeps` | Layer-scoped dep containers, narrowed via `toExecutionDeps()` / `toOutputDeps()` |

## Tech-debt follow-ups

- Re-enable `noExcessiveCognitiveComplexity` in `biome.json` (currently `"off"`). Most offenders were oclif `run()` bodies that are now collapsed via the operation-command factory — the count should be much lower; remeasure and flip the rule back to `"error"`.
- Wire `--input-dir` as a static flag group on every operation (Design A, explicit `--multi`/`--batch`). Logic already exists in `04-pipeline/02-resolve/input-dir.ts`; needs the flag group + a builder pre-flight hook.
- Decide `extend.ts`: keep as a `02-commands/meta/` chain-wrapper, or fold N-iteration support into the factory.
- Snapshot drift in `01-param-surface/02-catalog` + `03-describe/01-flag-schema` — SDK added `elementList` / `multiPrompt` / `thinkingLevel` descriptors; accept with `vitest -u` after eyeballing the diff.
- **Add a public-npm smoke job to CI** — after the CLI bundle is built, `npm pack dist/`, install the tarball in an isolated temp dir with **public registry only** (no `@picsart`/`@pulse` GitLab scopes), and run `gen-ai models`. Guards the self-contained-bundle invariant: any dep that stops being inlined (tsup `noExternal`) or that leaks back into the published `dependencies` would fail this offline install instead of shipping a broken package to public npm (the exact class of bug behind [picsart-mcp-cli-docs#1](https://github.com/PicsArt/picsart-mcp-cli-docs/issues/1) Path 2). Verified manually this session; not yet automated.

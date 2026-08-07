# CLI Architecture

The `gen-ai` CLI is built as **five numbered layers**, each importing only from the layers below it. `dependency-cruiser` enforces the rule; commits are blocked on violation.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  05  shells/         What the user invokes                          │
 │      ├─ 01-command-builder/   createOperationCommand(flow) factory  │
 │      ├─ 02-commands/          operations/, auth/, drive/, batch/…   │
 │      └─ 03-entry/             REPL backend                          │
 ├─────────────────────────────────────────────────────────────────────┤
 │  04  pipeline/       Request-time stages                            │
 │      ├─ 01-wizard-runner/     interactive 5-step resolver           │
 │      ├─ 02-resolve/           dispatcher (interactive | scripted)   │
 │      ├─ 03-execution/         sync/async SDK routing                │
 │      └─ 04-output/            display → download → drive → history  │
 ├─────────────────────────────────────────────────────────────────────┤
 │  03  definitions/    Declarative data — no I/O                      │
 │      ├─ 01-param-surface/     SDK paramConfig → CLI shapes          │
 │      └─ 02-flows/             21 FlowSpecs + composer               │
 ├─────────────────────────────────────────────────────────────────────┤
 │  02  services/       Auth, HTTP, persistence                        │
 │      └─ client.ts, auth.ts, drive.ts, history.ts, file-upload.ts …  │
 ├─────────────────────────────────────────────────────────────────────┤
 │  01  infrastructure/ Primitives — no upstream dependencies          │
 │      └─ errors/, flags/, ui-core/, ui/, utils/                      │
 └─────────────────────────────────────────────────────────────────────┘
```

For an interactive visualization with click-through block details and an animated request-flow walkthrough, open `CLI_ARCHITECTURE_VISUAL.html` in a browser.

## The layers

### 01 — Infrastructure (`src/01-infrastructure/`)

Lowest layer. Pure primitives. Imports nothing from upstream layers.

| Sub-block | Role |
|---|---|
| `errors/` | Typed `CliError` hierarchy: `UsageError`, `AuthError`, `ApiError`, `ValidationError`, `InsufficientCreditsError`, `FileError`, `NetworkError`. **Never** `throw new Error(...)` anywhere outside this folder. |
| `flags/` | Shared oclif Flag definitions: `baseFlags`, `outputFlags`, `modelFlags`, `generationFlags`, `kling-dsl`. |
| `ui-core/` | `ColorManager`, `OutputManager`, `createSpinner`, `renderCard`/`renderBadge`/`renderDivider`/`renderKeyValue`/`renderTable`. Pure renderers — no I/O. |
| `ui/` | High-level terminal output: banner, prompt-box, card-based help, theme. |
| `utils/` | `fuzzyFilter`, `getLocaleInfo`, `badgePriority`, `runPool`, `detectMediaType`, `getSessionId`, terminal-image, `writeDebugLog`. |

### 02 — Services (`src/02-services/`)

Auth, HTTP, persistence. The single SDK-client entry point.

| File | Role |
|---|---|
| `client.ts` | **The only SDK client.** `getAiClient()` returns a `createClient()` instance from `@picsart/ai-sdk` with Drive enabled. `getAuthenticatedFetch()` wraps `fetch` with auto-refresh. |
| `auth.ts`, `authenticated-fetch.ts` | Credential lifecycle. |
| `file-upload.ts` | `resolveAllFiles()` — local paths → CDN URLs. Called by the resolver. |
| `drive.ts` | `ensureRootFolder`, `ensureSubfolder`, `saveFileToDrive` — all routed through `getAiClient()`. |
| `history.ts` | `appendHistory`, `getLastEntry`, `clearHistory`. |
| `user-config.ts`, `constants.ts`, `device-id.ts`, `self-update.ts`, `update-check.ts` | The remaining persistence + bookkeeping. |

### 03 — Definitions (`src/03-definitions/`)

Pure data + pure functions. No I/O, no singletons.

#### `01-param-surface/` — SDK paramConfig → CLI shapes

| Sub-block | Role |
|---|---|
| `01-primitives/` | `ALIAS_MAP` (short flags / char keys) + `camelToKebab()` coercion. |
| `02-catalog/` | `loadCatalog()` / `getCatalog()` — walks every model's `paramConfig` once and produces a merged `ParamSurface` index. |
| `03-describe/` | `generateFlagsFromCatalog()` → oclif `FlagSet`. `generateWizardStepsFromCatalog()` → `WizardStep[]`. |
| `04-interpret/` | `readFlagsIntoContext()` / `readWizardAnswersIntoContext()` — convert parsed inputs into SDK `GenerationContext`. |

#### `02-flows/` — Declarative flow registry

| Sub-block | Role |
|---|---|
| `01-static/` | Hand-maintained groups with no SDK descriptor source: `01-static-flags` (universal / output / model / prompt-input), `02-static-steps` (output / confirm), `03-catalog-filter`, `04-tool-id-match`. |
| `02-registry/` | `FlowSpec` type + `defineFlow()` + the `FLOWS` map. **21 flows**: `generate` (universal) + 20 specialized (`image`, `video`, `music`, `remove-bg`, `change-bg`, …). |
| `03-compose/` | `composeFlagsForFlow(flow, catalog, models)` → final oclif `FlagSet`. `composeWizardForFlow(...)` → final `WizardStep[]`. |

### 04 — Pipeline (`src/04-pipeline/`)

Request-time stages. Each stage runs once per command invocation.

| Sub-block | Role |
|---|---|
| `01-wizard-runner/` | 5-step interactive resolver: model → files → params → prompt → confirm. BACK / CANCEL / SKIP navigation via sentinel symbols. |
| `02-resolve/` | Dispatcher entry: `resolveInputs(flow, flags, deps)`. Runs `normalizePromptInput` (stdin / `--prompt-file`) first, picks interactive vs scripted, then uploads local files via `02-services/file-upload`. Returns a `ResolvedInputs` whose `files` slots are all URLs. |
| `03-execution/` | `execute(inputs, deps, options)`. Picks sync or async based on `model.syncExecute`. Calls `getAiClient()` from `02-services/client`. Honors `AbortSignal`. |
| `04-output/` | `handleOutput(result, config, deps, driveCtx?)`. Pipeline: display → download → drive-save → history → extras (clipboard, open, bell, notify). Non-critical step failures become warnings, not throws. |

### 05 — Shells (`src/05-shells/`)

What the user invokes. Imports from every layer below.

| Sub-block | Role |
|---|---|
| `01-command-builder/` | `createOperationCommand(flow): typeof Command` factory + `runOperation(flow, flags, deps)` pure pipeline driver. Helpers (`build-output-config`, `build-drive-context`, `handle-credits-error`, `render-progress`) are builder internals. |
| `02-commands/` | `operations/` — 20 one-liner files, one per FLOW. `auth/`, `drive/`, `batch/`, `config/`, `history/`, `models/` — source-grouped families. Top-level: `completion`, `credits`, `extend`, `pricing`, `redo`, `update`, `validate`, `version`. |
| `03-entry/` | REPL backend: `repl.ts`, `menu.ts`, `shortcuts.ts`, `menu-registry.ts`. |

## Import rules

Enforced by `.dependency-cruiser.cjs`. Top-down — a layer may import from any layer below it, never above.

| Layer | May import from | Must NOT import from |
|---|---|---|
| 05-shells | 04-pipeline, 03-definitions, 02-services, 01-infrastructure | nothing higher (it is the top) |
| 04-pipeline | 03-definitions, 02-services, 01-infrastructure | 05-shells |
| 03-definitions | 02-services (rarely), 01-infrastructure | 04-pipeline, 05-shells |
| 02-services | 01-infrastructure | 03-definitions, 04-pipeline, 05-shells |
| 01-infrastructure | (nothing inside `src/`) | every other layer |

Each block also exposes a single `index.ts` barrel; consumers import from the barrel, not from internal files.

## How a request flows

For a single `gen-ai <op>` invocation (e.g. `gen-ai change-bg -i ./photo.jpg -p "neon street"`):

1. **05-shells/02-commands/operations/change-bg.ts** is a 6-line file: `export default createOperationCommand(FLOWS['change-bg']);`
2. **05-shells/01-command-builder/builder.ts** resolves `composeFlagsForFlow(FLOWS['change-bg'], catalog, models)` at class load. oclif parses argv against that flag set. `runOperation()` takes over.
3. **04-pipeline/02-resolve/resolve.ts** runs `normalizePromptInput` (stdin / `--prompt-file` → `flags.prompt`), then dispatches:
   - Interactive (TTY + no `--no-input`) → **04-pipeline/01-wizard-runner**, which consumes the `WizardStep[]` from the composer + the schema from Param Surface.
   - Scripted → `02-resolve/scripted/resolver.ts`, which reads the flag bag through Param Surface's `flag-reader`.
4. **02-services/file-upload.resolveAllFiles** turns any local paths in `inputs.files` into CDN URLs.
5. **04-pipeline/03-execution/execute.ts** calls `getAiClient()` from **02-services/client**, routes sync vs async, emits progress to the spinner, honors `SIGINT` via `AbortController`.
6. **04-pipeline/04-output/handle.ts** runs the post-execution pipeline: display → download → drive-save (via **02-services/drive**) → history (via **02-services/history**) → extras.
7. `runOperation` returns. The process exits 0.

`InsufficientCreditsError` is the one error the builder catches: it prompts the user to open the billing page. Every other error bubbles up to `BaseCommand.catch()` for typed rendering.

## How to add things

### A new operation command (specialized FLOW)

1. Drop a new flow folder under `src/03-definitions/02-flows/02-registry/02-flows/NN-<id>/<id>.ts`. Export a `FlowSpec` via `defineFlow({...})`. Include `id`, `description`, `modelFilter`, `requiredInputs`, `staticFlagGroups`, `staticStepGroups`, optional `examples`.
2. Register it in `02-flows/02-registry/02-flows/_flows.ts` (the `FLOWS` map).
3. Drop a one-liner command at `src/05-shells/02-commands/operations/<id>.ts`:
   ```ts
   import { FLOWS } from '#flows';
   import { createOperationCommand } from '../../01-command-builder/builder.ts';
   export default createOperationCommand(FLOWS['<id>']);
   ```
4. Register the class in `src/commands-manifest.ts`.

### A new utility command (not an operation)

1. Create `src/05-shells/02-commands/<group>/<name>.ts` (or top-level if it has no family). Extend `BaseCommand`.
2. Use shared flags from `01-infrastructure/flags/` and helpers from `02-services/`.
3. Register the class in `src/commands-manifest.ts`.

### A new generation flag (`--foo`)

The CLI is a **consumer** of `@picsart/ai-sdk`. Never edit `specs/src/` to satisfy a CLI need — only fields the SDK has declared as `paramConfig` descriptors can become CLI flags.

1. Check `specs/src/vendors/catalog/*.ts` — does any `paramConfig` declare a descriptor for the field?
   - **No** → file the gap in `playgroundwiki/sdk/coverage-gaps.md`; stop.
   - **Yes** → continue.
2. The descriptor automatically appears in the catalog at next process start; no flag file needs editing.
3. If you want a short alias (`-x`), add it to `ALIAS_MAP` in `src/03-definitions/01-param-surface/01-primitives/01-aliases/aliases.ts`.
4. If multiple models declare the field with different shapes, Param Surface flags the conflict via `surface.conflicts`.

### A new static flag (no SDK descriptor)

Goes in a static flag group at `src/03-definitions/02-flows/01-static/01-static-flags/static-flags.ts`. Either extend an existing group (`universal`, `output`, `model`, `prompt-input`) or add a new group. Flows opt in via their `staticFlagGroups` list.

### A new model

Models live in the specs workspace (`specs/src/vendors/catalog/<vendor>.ts`), not in the CLI. Add the model there per the main project `CLAUDE.md`. The CLI picks it up automatically via `@picsart/ai-sdk` — as long as the model satisfies an existing FlowSpec's `modelFilter`, it shows up in that command's wizard and accepts that command's flags.

## Build & checks

| Command | What it runs |
|---|---|
| `npm run lint` | Biome check on `src/` |
| `npx tsc --noEmit` | Type check (whole package) |
| `npx depcruise src` | Import-boundary check |
| `npx vitest run` | All co-located `*.test.ts` under `src/01-…05-…` |
| `npm run build` | tsup bundle |

### Pre-commit hook

Husky → `lint-staged` runs on every staged `.ts` file:
1. ESLint (root config — also runs `tsc --noEmit` once)
2. Biome (lint + format on staged files)
3. `depcruise src/`
4. `scripts/check-file-size.sh` (600-line limit)
5. `scripts/check-typed-errors.sh` (no raw `throw new Error` in layers)
6. `scripts/check-no-singletons.sh` (no `getColor()` / `getOutput()` outside infra)

## Testing

Vitest. Co-located: every `<name>.ts` has a sibling `<name>.test.ts`. Tests reference modules via the same `#alias` paths as production code.

| Helper | Where |
|---|---|
| `vi.hoisted()` for mock vars | builder + step tests |
| `__test-utils__/models-min.ts` | fixture models for Param Surface tests |
| `vitest.config.ts` | scoped to `src/01-…05-…` |

The legacy node-runner suite at `__tests__/run-all.ts` only covers a few integration tests; new tests go co-located.

## Key types

Defined in `src/types.ts` and `src/deps.ts`:

| Type | Carries |
|---|---|
| `ResolvedInputs` | `model`, `params` (incl. prompt), `files` (URLs only) — resolver output, executor input |
| `ExecutionResult` | `status`, `url`, `results[]`, `model`, `params`, `durationMs`, `error?` — executor output, output-layer input |
| `OutputConfig` | `download`, `driveSave`, `driveFolder`, `open`, `clipboard`, `bell`, `notify`, `jsonMode`, `quietMode`, `plainMode` |
| `FlowSpec` | `id`, `description`, `modelFilter`, `requiredInputs`, `staticFlagGroups`, `staticStepGroups`, `examples?` — declarative command surface |
| `CliDeps` / `ExecutionDeps` / `OutputDeps` | Layer-scoped dependency containers, narrowed via `toExecutionDeps()` / `toOutputDeps()` |

`OperationConfig` (the legacy adapter) is gone. The pipeline takes `FlowSpec` directly.

## Where things are NOT

- Singletons (`getColor`, `getOutput`) are forbidden outside `01-infrastructure`. Every layer-touching function takes `deps` explicitly. Enforced by `scripts/check-no-singletons.sh`.
- File uploads are NOT in `03-execution`. They happen in `02-resolve` before the executor sees `inputs.files`.
- Drive operations are NOT in `04-output/drive.ts` — that file orchestrates. The actual API calls go through `02-services/drive.ts` → `getAiClient().drive.*`.
- There is NO duplicate `createClient()` anywhere — `02-services/client.ts:getAiClient()` is the only SDK-client entry.

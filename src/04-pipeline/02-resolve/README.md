# 02-resolve — Input Resolution

Turns CLI flags + (optionally) a wizard session into a fully-typed `ResolvedInputs` the executor can hand to the SDK.

## Responsibility

Given a `FlowSpec` and the parsed `flags` for a command:

1. Pick the model (from `--model` or interactive search).
2. Collect files (`--image`, `--video`, …) and params (model-specific flags).
3. Validate that every `flow.requiredInputs` is present.
4. **Upload any local file paths → URLs** (per Decision 2 — the executor never sees disk paths).
5. Return `{ model, params, files }` or `null` if the interactive user cancelled.

## Public surface

```ts
resolveInputs(flow, flags, deps) → Promise<ResolvedInputs | null>
```

Dispatcher in `resolve.ts`. Routes to `01-wizard-runner/resolver.ts` (interactive) or `./scripted/resolver.ts` (non-interactive) based on `isInteractiveMode(deps.flags)`, then performs the upload pass via `resolveAllFiles()` from `02-services/file-upload.ts`.

## Internal pieces

| File | What it does |
|---|---|
| `resolve.ts`         | Mode dispatcher + post-resolution upload step |
| `scripted/resolver.ts` | Reads flags only — no prompts, fails fast on missing inputs |
| `types.ts`           | `buildParamsFromFlags`, `resolveModelFromFlag`, `validateRequiredInputs`, `getModelsForOperation` |
| `input-dir.ts`       | `--input-dir` → file-flag expansion (`buildGenerateInputArgs`, `planInputDir`) |
| `media.ts`           | Media-type detection for mixed-input validation |

Interactive mode lives next door in `01-wizard-runner/` because it does I/O — this directory is for the dispatcher and the headless path.

## Contract with the executor

After this block returns, every entry in `ResolvedInputs.files` is either an `https://` URL or absent. Prompt and all model params live inside `params` (matching the SDK's `GenerationContext` shape).

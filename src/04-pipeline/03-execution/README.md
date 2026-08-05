# 03-execution — Generation Execution

Takes a fully-resolved `ResolvedInputs` (every file already an URL) and runs it through the SDK, yielding a normalized `ExecutionResult`.

## Responsibility

1. Get the shared SDK client via `getAiClient()` from `02-services/client.ts` — never instantiates its own.
2. Merge `inputs.files` URLs into the SDK's `GenerationContext` keys (`imageUrls`, `videoUrl`, `startFrame`, `endFrame`, `audioUrl`).
3. Route by `model.syncExecute`:
   - **sync** models → one request, await result.
   - **async** models → submit job, subscribe to status, fetch result on `COMPLETED`.
4. Emit progress via the optional `onProgress` callback.
5. Honour `AbortSignal` — return `status: 'cancelled'` instead of throwing.

## Public surface

```ts
execute(inputs, deps, options?) → Promise<ExecutionResult>
```

`options`: `{ signal?, onProgress?, pollIntervalMs? }`. `deps` is `ExecutionDeps` (no UI). Errors from the SDK propagate; cancellation does not.

## Internal pieces

| File | What it does |
|---|---|
| `execute.ts`  | Entry point — assembles params from `inputs`, picks sync vs async |
| `sync.ts`     | Single-request models (image, simple edits) |
| `async.ts`    | Submit → subscribe → result loop with progress + abort |
| `validate.ts` | Dry-run validation via `Models.validate()` for `--validate` flag |

## What this block does NOT do

- Upload files — that's the resolver's job (Decision 2). `inputs.files` arrives URL-only.
- Display or download results — that's `04-output/`.
- Build or own an SDK client — it asks `02-services/client.ts` for one.

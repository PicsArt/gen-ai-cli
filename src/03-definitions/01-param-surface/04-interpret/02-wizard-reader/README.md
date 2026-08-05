# Wizard Reader (interpret → ctx)

The interpret-half twin of `03-describe/02-wizard-schema/`. Reads the answers object a wizard runner produces and emits a `Partial<GenerationContext>` — the same shape the SDK's `buildPayload` reads.

This is the wizard-side complement of `01-flag-reader/`. Both produce ctx, but they consume different shapes:

```
flag-reader   ← flat oclif flags object, subfield arrays paired by position
                (--shot-prompt "a" --shot-prompt "b" --shot-duration 5 --shot-duration 7)

wizard-reader ← structured items — the runner did the per-item loop while
                prompting, so each item carries its subfields together
                ({ multiPrompt: [{ prompt: 'a', duration: '5' }, ...] })
```

Both produce the same `multiPrompt` array in ctx; the assembly happens in a different place.

## The pipeline

```
wizard runner produces:           wizard-reader returns:
─────────────────                 ─────────────────
{ prompt: 'a sunset',             { prompt: 'a sunset',
  aspectRatio: '16:9',              aspectRatio: '16:9',
  duration: 10,                     duration: 10,
  generateAudio: true,              generateAudio: true,
  multiPrompt: [                    multiPrompt: [
    { prompt: 'wide',                 { index: 0,
      duration: '5' },                  prompt: 'wide',
    { prompt: 'close',                  duration: '5' },
      duration: '7' }                 { index: 0,
  ]                                     prompt: 'close',
}                                       duration: '7' }
                                    ]
                                  }
```

## How it works

Walks `catalog.all()`. For each `ParamSurface`:

1. **`file` kind** → skip (file pipeline owns these).
2. Read `answers[surface.key]` (camelCase ctx key, NOT the kebab flag name).
3. If `undefined` → omit the key from ctx.
4. **`object` kind** → expect an array of subfield-keyed records; coerce each subfield value, backfill missing optionals from descriptor defaults, throw `UsageError` if a no-default subfield is missing.
5. **Scalar kinds** (`enum`, `boolean`, `range`, `text`) → run through `coerceToDescriptor` from primitives/coercion.

## Why answer keys are camelCase

The wizard runner builds `answers` keyed by each `WizardStep.key`, and wizard-schema emits steps under `surface.key` (camelCase). That's why wizard-reader looks up `answers[surface.key]`, not `answers[surface.flag]` — unlike flag-reader, which reads under the kebab flag name because that's what oclif emits.

The same key shape (camelCase) makes the answers object directly resemble the ctx shape, which is the only reasonable mental model for a runner that's building the result interactively.

## What it does NOT do

- Drive the prompts. That's the runner block.
- Validate per-flow acceptance. That's the flow-filter block.
- Apply model defaults to omitted top-level keys. The runner is expected to have prompted for everything required; missing keys are simply omitted (consistent with flag-reader).
- Resolve files for upload. That's the resolver's file pipeline.

## Public API

```ts
import { collectContextFromAnswers } from './wizard-reader.ts';

collectContextFromAnswers(
  answers: Record<string, unknown>,
  catalog: Catalog,
): Partial<GenerationContext>
//   walks every surface; returns ctx with only the keys whose answer
//   was provided. Throws UsageError on coercion or object-subfield
//   validation failure.
```

## Symmetry with flag-reader

The shape of both readers' output is identical (`Partial<GenerationContext>`). The shape of their input differs because:

| Concern | flag-reader | wizard-reader |
|---|---|---|
| Input source | oclif-parsed argv | runner's answers object |
| Key style | kebab flag name | camelCase ctx key |
| Object descriptor input | flat subfield arrays paired by position | array of subfield-keyed records |
| Defaults backfill | yes (interpret/objects) | yes (here, same rule) |
| `UsageError` on missing required subfield | yes | yes |

A model that has both flag-reader and wizard-reader paths must produce the same ctx for the same user intent — that contract is enforced by both halves running every answer through the shared `coerceToDescriptor` and using the same default-resolution rule.

## File layout

```
02-wizard-reader/
├── README.md                ← this file
├── wizard-reader.ts         ← collectContextFromAnswers + object walker
└── wizard-reader.test.ts    ← 23 it-blocks across kinds + objects + key shape + noise
```

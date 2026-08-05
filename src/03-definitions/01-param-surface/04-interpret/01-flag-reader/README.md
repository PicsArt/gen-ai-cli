# Flag Reader (interpret → ctx)

The inverse of `03-describe/01-flag-schema/`. Reads oclif-parsed flag values and produces the generation context the SDK's `buildPayload` expects.

## The pipeline

```
user types:                  oclif gives you:                flag-reader returns:
─────────────────            ─────────────────               ─────────────────
gen-ai generate              { prompt: 'a sunset',           { prompt: 'a sunset',
  -p "a sunset"                'aspect-ratio': '16:9',         aspectRatio: '16:9',
  --ar 16:9                    duration: '10',                 duration: 10,        ← parsed
  -d 10                        'generate-audio': true,         generateAudio: true,
  --generate-audio             'shot-prompt': ['a', 'b'],      multiPrompt: [
  --shot-prompt "a"            'shot-duration': ['5', '7'] }     { index: 0,
  --shot-prompt "b"                                                prompt: 'a',
  --shot-duration 5                                                duration: '5' },
  --shot-duration 7                                              { index: 0,
                                                                   prompt: 'b',
                                                                   duration: '7' }
                                                               ]
                                                             }
```

## How it works

Walks `catalog.all()`. For each `ParamSurface`:

1. **`file` kind** → skip. The resolver's file pipeline handles `--image`, `--video`, `--audio` separately (uploads local paths to the CDN).
2. **`object` kind** → delegate to `./objects.ts` (`interpretObjectArray`). It knows how to read the per-subfield flag names and zip them by position.
3. **Scalar kinds** (`enum`, `boolean`, `range`, `text`) → read `flags[surface.flag]` and run through primitives/coercion's `coerceToDescriptor` to get the typed value.

If the resulting value is `undefined` (flag wasn't set), the key is omitted from the output.

## Why this is so small

The top-level reader is a thin coordinator. It owns:

- The walk order (one pass over `catalog.all()`)
- The catalog→ctx key mapping (always `surface.flag` → `surface.key`)
- The kind dispatch (file → skip, object → `./objects.ts`, else → primitives/coercion)

Everything else lives elsewhere:

- Validation rules live in `coerceToDescriptor` (primitives/coercion)
- Per-subfield assembly lives in `./objects.ts` (interpret-half of object descriptors)
- Alias resolution already happened in the catalog — `surface.flag` is the alias-resolved canonical name

## oclif normalizes aliases for free

When the describe-half declares `Flags.string({ aliases: ['ar'] })` on a flag named `'aspect-ratio'`, oclif stores the parsed value under `'aspect-ratio'` regardless of whether the user typed `--aspect-ratio 16:9` or `--ar 16:9`. Same for chars: `-p X` lands under `'prompt'`.

This reader only reads under the canonical `surface.flag` and doesn't need alias-aware logic.

## What it does NOT do

- Validate per-flow flag acceptance. That's a downstream flow-filter block. Flags the catalog doesn't know about (e.g. `--json`, `--quiet`) are silently ignored.
- Resolve files for upload. That's the resolver's file pipeline.
- Decide which model to use. That's the resolver's model-selection step.
- Coerce or validate beyond what primitives/coercion already does.
- Apply model defaults or required-field checks. That's a downstream block (assemble / execute-prep).

## Public API

```ts
import { collectGenerationContext } from './flag-reader.ts';

collectGenerationContext(
  flags: Record<string, unknown>,
  catalog: Catalog,
): Partial<GenerationContext>
//   walks every surface; returns ctx with only the keys that were set
//   throws UsageError on validation failure (bubbled from primitives/coercion or ./objects.ts)
```

## File layout

```
01-flag-reader/
├── README.md                ← this file
├── flag-reader.ts           ← collectGenerationContext (one function)
├── flag-reader.test.ts      ← scalar / mixed / real-SDK coverage
├── objects.ts               ← interpret-half of object descriptors
└── objects.test.ts          ← single/multi-field interpret coverage
```

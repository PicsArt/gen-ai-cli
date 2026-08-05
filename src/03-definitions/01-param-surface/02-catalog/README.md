# Block 3 — Catalog

Takes the SDK's per-model parameter lists and produces ONE lookup table the CLI can use.

## The problem this solves

The SDK ships ~150 models. Each model carries its own `paramConfig` — a list of parameters that model accepts. Two examples (simplified):

```ts
// Model A — Kling V3 video
paramConfig: {
  prompt:       { descriptor: { kind: 'text', required: true } },
  aspectRatio:  { descriptor: { kind: 'enum', valueType: 'string',
                                options: ['16:9', '9:16'] } },
  duration:     { descriptor: { kind: 'enum', valueType: 'number',
                                options: [5, 10] } },
}

// Model B — Flux 2 Pro
paramConfig: {
  prompt:       { descriptor: { kind: 'text', required: true } },
  aspectRatio:  { descriptor: { kind: 'enum', valueType: 'string',
                                options: ['1:1', '16:9', '4:3'] } },
  guidance:     { descriptor: { kind: 'range', min: 1, max: 10 } },
}
```

The CLI needs to know every flag any model accepts, across all 150 of them — not 150 separate lists, one merged list. That's what Catalog produces.

## What you get

Given the two models above, `loadCatalog([modelA, modelB], ALIAS_MAP)` returns:

```ts
{
  bySdkKey: Map {
    'prompt'      → ParamSurface { flag: 'prompt', char: 'p', kind: 'text',
                                   models: ['model-a', 'model-b'] },
    'aspectRatio' → ParamSurface { flag: 'aspect-ratio', flagAliases: ['ar'],
                                   kind: 'enum',
                                   options: ['16:9', '9:16', '1:1', '4:3'], ← merged
                                   models: ['model-a', 'model-b'] },
    'duration'    → ParamSurface { flag: 'duration', char: 'd', kind: 'enum',
                                   options: [5, 10],
                                   models: ['model-a'] },
    'guidance'    → ParamSurface { flag: 'guidance', kind: 'range',
                                   min: 1, max: 10,
                                   models: ['model-b'] },
  },
  byFlag: Map {
    'prompt' → ..., 'p' is NOT in byFlag (chars use a different lookup),
    'aspect-ratio' → ..., 'ar' → ... (same surface, two names),
    'duration' → ..., 'guidance' → ...,
  },
  all() → returns all four ParamSurfaces sorted alphabetically by key
}
```

Four parameter keys total. Two models, four unique flags. Notice three things happened:

1. **Dedup**: `prompt` and `aspectRatio` are declared by both models but show up once.
2. **Option union**: `aspectRatio` options `['16:9', '9:16']` and `['1:1', '16:9', '4:3']` merged to `['16:9', '9:16', '1:1', '4:3']`. The CLI flag will accept any of them.
3. **Aliases applied**: `prompt` got `char: 'p'` (so `-p` works), `aspectRatio` got `flagAliases: ['ar']` (so `--ar` works), both from `ALIAS_MAP` in Block 1.

## When things conflict

What if Model A says `duration` is an enum `[5, 10]` and Model C says `duration` is a range `min: 0, max: 30`? The CLI can only render one `--duration` flag.

The catalog has two modes:

| Mode | Used by | What happens |
|---|---|---|
| permissive (default) | production | first-seen descriptor wins; the divergent one gets recorded in `surface.conflicts` so downstream code can see what happened |
| strict | `dev:params` drift detector + unit tests | throws `ParamConflictError` with the key, both model ids, and both kinds |

A real conflict exists right now in the SDK: `duration` is `enum:number` on Kling video models but `range` on `kling-t2a` (Kling text-to-audio). In permissive mode the catalog picks the first descriptor seen (enum), keeps building, and records the divergence. The CLI still works; the SDK gap is visible via `surface.conflicts`.

## Two ways to call it

```ts
// Tests use this — pass fixture models, control everything.
const catalog = loadCatalog(fixtureModels, ALIAS_MAP);

// Production uses this — walks the real SDK once, caches forever.
const catalog = getCatalog();
```

`getCatalog()` is memoized at module load. First call walks `Models.list()`. Every later call returns the same object.

## Where each piece comes from

A `ParamSurface` is assembled from three inputs:

```
SDK model's paramConfig entry         →  descriptor, label, required
ALIAS_MAP entry for this key (if any) →  flag override, char, extra aliases
Bookkeeping across all models         →  models[], requiredInModels[],
                                          perModelLabels, conflicts
```

The flag name is decided by:

1. If `ALIAS_MAP[key].flag` is set → use that
2. Else → `camelToKebab(key)` from Block 2

If `ALIAS_MAP[key].aliases` exists, those names also register in `byFlag` pointing to the same surface, so `--aspect-ratio` and `--ar` both resolve to the same parameter.

## What it does NOT do

This block is a pure data transformation. It does NOT:

- Build oclif `Flags` objects (that's Block 5)
- Parse user input (that's Block 6)
- Run wizard prompts (that's Block 7)
- Coerce values (that's Block 2)
- Validate at runtime — it just exposes what the SDK declares
- Watch for SDK changes; it's a one-time snapshot at process start

## API summary

```ts
loadCatalog(models, aliases, options?): Catalog
getCatalog(): Catalog
class ParamConflictError extends Error

type ModelLike = { id: string; paramConfig: ModelParams }
interface ParamSurface { key, flag, char?, flagAliases, descriptor,
                         models, requiredInModels, perModelLabels, conflicts }
interface Catalog { bySdkKey, byFlag, all() }
```

## Tests

277 assertions in three layers:

1. **Fixture tests** — hand-built models in `__fixtures__/models-min.ts`. Cover every merge rule, alias case, conflict case.
2. **Real-SDK integration** — every `ALIAS_MAP` key (minus a small documented exemption list) maps to a real SDK descriptor. If the SDK closes a gap, the exemption test fails and tells you to remove the entry.
3. **Snapshot** — 49 SDK descriptor keys + their merged shapes locked. A future SDK change shows up as a snapshot diff in CI; reviewer accepts it via `vitest -u`.

## Dev-time audit

Tests catch drift in CI. For local development, a friendlier report is available:

```bash
npm run audit:params
```

Walks the real catalog and prints:

- How many SDK descriptors exist; how many have an alias entry vs. use the default kebab name
- Descriptors with no `ALIAS_MAP` entry (candidates for short aliases)
- Flag names longer than 15 characters (candidates for shorter aliases)
- Orphan alias entries (no matching SDK descriptor) — flagged as either exempt-known or unexpected
- Closed gaps — entries on the exemption list that the SDK now declares (remove them)
- Cross-model kind conflicts the catalog merged permissively (e.g. `duration` is enum:number on Kling video, range on Kling text-to-audio)

Exit code is non-zero when action is needed (unexpected orphans or closed gaps), so this can also run in a pre-push hook.

## Exemption list

Some `ALIAS_MAP` keys don't have a real SDK descriptor. The test exempts these:

| Key | Why |
|---|---|
| `model` | CLI built-in — picks which SDK model to use, not a parameter |
| `externalTaskId` | SDK gap — Kling video buildPayload reads it, no paramConfig descriptor |
| `outputFormat` | SDK gap — OpenAI gpt-image, same pattern |
| `soundEffectPrompt`, `bgmPrompt`, `asmrMode` | SDK gaps — Kling V2A, same pattern |

All gaps are open items against `@picsart/ai-sdk`, filed in the `pa-gen-ai-sdk` repo that owns the catalog. When the SDK adds the descriptor, the exemption is removed.

## File layout

```
03-catalog/
├── README.md             ← this file
├── catalog.ts            ← loadCatalog + getCatalog
├── catalog.test.ts       ← 27 it-blocks, 277 assertions
├── __fixtures__/
│   └── models-min.ts     ← shared fixture for Blocks 3-7
└── __snapshots__/
    └── catalog.test.ts.snap
```

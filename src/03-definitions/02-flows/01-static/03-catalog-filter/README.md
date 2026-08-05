# Catalog Filter

Produces a `Catalog` view scoped to a subset of models. Param Surface gives the CLI one universal catalog built from `Models.list()` — every flag and wizard step across every model. A flow (e.g. `remove-bg`) only cares about a small subset of those models, so this primitive narrows the catalog *before* a composer renders flags or wizard steps.

## Why this lives in the Flows block, not Param Surface

Param Surface knows about the SDK. Filtering by "which models this command uses" is a CLI-application concern — it depends on the flow registry, not the SDK. Keeping the filter here keeps Param Surface free of any per-command knowledge.

## Why a `Set<string>` of model ids instead of a `(model) => boolean` predicate

The catalog stores only model **ids** on each surface (not full model objects), so a predicate would need *both* the catalog AND the model list to apply. Pushing the predicate one layer up (composer applies `flow.modelFilter` to `Models.list()` to derive the id set) keeps this primitive small, pure, and self-contained.

The flow composer does:

```ts
const matching = new Set(
  Models.list().filter(flow.modelFilter).map((m) => m.id),
);
const filtered = filterCatalog(getCatalog(), matching);
```

`filterCatalog` itself never touches `Models.list()`.

## Behavior

For each surface in the input catalog:

- **Dropped** if none of its `models[]` ids are in the allowed set.
- **Kept** otherwise — but the surface's per-model metadata is trimmed to only the allowed ids:
  - `models` → only allowed ids
  - `requiredInModels` → only allowed ids
  - `perModelLabels` → only allowed ids (so a flag's label can't come from a model that's no longer in the flow)
  - `conflicts` → only conflicts whose `modelId` is allowed

The returned `Catalog` rebuilds `bySdkKey` and `byFlag` (including aliases) from the kept surfaces, and `all()` preserves the alphabetical-by-key ordering Param Surface promised. The output is a fresh object — input is never mutated.

## Public API

```ts
import { filterCatalog } from './catalog-filter.ts';

filterCatalog(catalog: Catalog, allowedModelIds: ReadonlySet<string>): Catalog
```

## What it does NOT do

- **Talk to `Models.list()`** — the caller does that. This primitive is pure data → data.
- **Cache.** Each call rebuilds. Catalogs are cheap; composers can wrap with their own memoization if needed.
- **Apply a flow spec** — the spec is consumed by the composer, which then calls this primitive. Filter doesn't know what a `FlowSpec` is.

## File layout

```
03-catalog-filter/
├── README.md                ← this file
├── catalog-filter.ts        ← filterCatalog(catalog, idSet)
└── catalog-filter.test.ts   ← 14 it-blocks: edges, inclusion, trimming, lookup, ordering
```

# Flag Set Composer

The glue. Reads a `FlowSpec` plus runtime data and produces the final oclif `FlagSet` that a CLI command spreads into `static flags = {...}`.

## Pipeline

```
   FlowSpec ────────────┐
                        │
   Models.list() ──────►├── modelFilter ──► allowed-id Set
                        │                          │
   Catalog ─────────────┼─────► filterCatalog ─────┘
                        │              │
                        │              ▼
                        │      narrowed catalog
                        │              │
                        │              ▼
                        │      flag-schema → descriptor flags ──┐
                        │                                        ├──► merge ──► FlagSet
                        └─► STATIC_FLAG_GROUPS[name] × N ───────┘
                                                       static flags
```

1. Walk `models`, apply `flow.modelFilter`, collect matching ids into a `Set`.
2. Hand the set to `filterCatalog` — get a Catalog scoped to only those ids.
3. Run that through Param Surface's `generateFlagsFromCatalog` — get descriptor-derived flags.
4. For each name in `flow.staticFlagGroups`, look up the group in `STATIC_FLAG_GROUPS` and spread it.
5. Merge: descriptor flags first, then static groups. **Static wins on name collision.**

## Why static wins on collision

The cross-block collision test (in `01-static-flags/static-flags.test.ts`) asserts no name overlap between static flags and descriptor flags on a fixture catalog. With the real SDK, a future descriptor key could in theory shadow a static flag name. Resolving via "static wins" keeps CLI behavior invariants intact: `--json` always means "JSON output" regardless of what the SDK might add.

If a collision ever happens against the real SDK, the static flag still works as expected and the descriptor side gets dropped — a future audit task can flag it.

## Pure function, all deps injected

```ts
composeFlagsForFlow(
  flow: FlowSpec,
  catalog: Catalog,
  models: readonly ModelDefinition[],
): FlagSet
```

No singletons. The caller (CLI bootstrap, a test, a CI script) wires the deps. This keeps the composer testable in isolation against synthetic models + synthetic catalogs.

In production the caller is typically:

```ts
import { Models } from '@picsart/ai-sdk';
import { getCatalog } from '.../01-param-surface/02-catalog/catalog.ts';

const flags = composeFlagsForFlow(VIDEO_FLOW, getCatalog(), Models.list());
```

## What this composer does NOT do

- **Drive the wizard.** That's `02-wizard-flow/`.
- **Parse argv.** oclif does that, after spreading the FlagSet into a command.
- **Read parsed flag values.** Param Surface's `flag-reader` does that.
- **Validate the FlowSpec.** Type system + flow-spec tests do.
- **Cache.** Each call builds fresh. Catalogs are cheap; the CLI bootstrap can memoize once at startup if needed.

## File layout

```
01-flag-set/
├── README.md           ← this file
├── flag-set.ts         ← composeFlagsForFlow
└── flag-set.test.ts    ← empty / filtering / static groups / collision precedence
```

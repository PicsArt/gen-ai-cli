# Flag Schema (describe → oclif flags)

Turns the Catalog into oclif flag definitions. The output is spread into each operation command's `static flags = {...}` block at module load.

The symmetric inverse — turning the parsed flag values back into a generation context — lives in `04-interpret/01-flag-reader/`.

## What it does

Walks every `ParamSurface` in the catalog. For each one, picks the right oclif factory based on the descriptor kind and applies the alias-resolved name + char + aliases.

### Kind table

| `descriptor.kind` | Produces | Validation |
|---|---|---|
| `enum<string>` | `Flags.string({ options: ['a', 'b', ...] })` | oclif rejects values not in `options` |
| `enum<number>` | `Flags.string({ options: ['5', '10', ...] })` | oclif rejects; flag-reader converts to number |
| `boolean` | `Flags.boolean({ allowNo: true })` | `--foo` / `--no-foo` both accepted |
| `range` | `Flags.string()` | flag-reader parses + checks bounds |
| `text` | `Flags.string()` | flag-reader enforces `maxLength`/`minLength` |
| `catalog` | `Flags.string()` | free-string id; the live platform catalog validates membership |
| `file` | `Flags.string()` path flag (declaration only) | the resolver's file pipeline uploads and substitutes; flag-reader still skips these |
| `object` | delegated to `./objects.ts` (`describeObjectFlags`) | per-subfield repeatable flags |

### Why some kinds defer parsing to the flag-reader

oclif's `Flags.integer` and `Flags.float` parse eagerly with no bounds awareness. For `range` descriptors we want bounds in the error message, so we accept as `Flags.string()` and let the flag-reader's `coerceToDescriptor` (primitives/coercion) do the parse + bounds check + user-friendly error. Same for `enum<number>`: oclif validates membership against the stringified options, then the flag-reader converts the matched string to a number.

This keeps oclif as a permissive front door and concentrates type discipline in one place (primitives/coercion).

## Alias resolution

Each `ParamSurface` already carries the resolved flag name (`flag`), short char (`char`), and extra long-form aliases (`flagAliases`) — the catalog did that work using `ALIAS_MAP`.

Flag-schema just spreads them into the oclif factory:

```ts
Flags.string({
  description: '<label>',
  options: [...],
  char: surface.char,      // e.g. 'p' for --prompt
  aliases: ['ar'],         // e.g. for --aspect-ratio
})
```

Conditional spread avoids passing `undefined` (oclif's char prop is type-narrow).

## Description text

For each flag the description is the first non-empty label across all models that declared the key. Falls back to the camelCase key if no model supplied a label.

## What it does NOT do

- Coerce user values. That's `04-interpret/01-flag-reader/`.
- Compose with static flag groups (universal, output, input, mode). That belongs in a downstream flag-library block.
- Decide which flow accepts which flag. That belongs in a downstream flow-filter block.

## Public API

```ts
import { generateFlagsFromCatalog } from './flag-schema.ts';

generateFlagsFromCatalog(catalog: Catalog): FlagSet
//   walks every surface and emits one entry per non-file descriptor;
//   object descriptors expand to multiple entries (one per subfield)

export type FlagSet = Record<string, unknown>;
//   spreadable into oclif `static flags = { ... }`
```

## File layout

```
01-flag-schema/
├── README.md                ← this file
├── flag-schema.ts           ← kind-table dispatch
├── flag-schema.test.ts      ← top-level entry tests + real-SDK snapshot
├── objects.ts               ← describe-half of object descriptors
├── objects.test.ts          ← single/multi-field describe coverage
└── __snapshots__/
    └── flag-schema.test.ts.snap   ← real SDK flag set, locked
```

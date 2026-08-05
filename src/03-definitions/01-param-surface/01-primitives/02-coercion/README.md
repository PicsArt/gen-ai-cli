# Block 2 — Coercion

Pure value conversion plus camelCase ↔ kebab-case helpers. Used by Block 5 (Flag Generator), Block 6 (Value Collector), and Block 7 (Wizard Generator).

## What it does

Two unrelated jobs, both pure and synchronous:

### 1. Name conversion

- `camelToKebab('aspectRatio')` → `'aspect-ratio'`
- `kebabToCamel('aspect-ratio')` → `'aspectRatio'`

Used by Block 3 (Catalog) to derive default flag names from SDK descriptor keys, and by Block 6 (Value Collector) to read flag values back into a context record keyed by the camelCase SDK names.

The two functions round-trip: `kebabToCamel(camelToKebab(key)) === key` for every camelCase key.

### 2. Value coercion by descriptor kind

Given a raw value (typically a string from a CLI flag) and an SDK descriptor, return the typed value the SDK expects — or throw `UsageError` with a clear message.

| `descriptor.kind` | Accepts | Returns | Throws when |
|---|---|---|---|
| `enum<string>` | string | string | value not in `options` |
| `enum<number>` | string or number | number | not numeric, or not in `options` |
| `boolean` | boolean or `'true'`/`'false'` | boolean | anything else |
| `range` | string or number | number | not numeric, or out of `[min, max]` |
| `text` | string | string | not a string, too short, or too long |
| `file` | — | — | always — file values are handled by the file pipeline |
| `object` | — | — | always — object-array values are handled by Block 4 |

`undefined` input passes through as `undefined` — the caller (Block 6) only invokes coercion when the user actually provided a value.

## When to use

- **Block 3 (Catalog)** uses `camelToKebab` to derive a default flag name from each SDK descriptor key.
- **Block 6 (Value Collector)** uses `coerceToDescriptor` to convert raw flag values into typed context values.
- **Block 7 (Wizard Generator)** uses the same coercion to validate interactive answers before writing them back to context.

## What it does NOT do

- Read from the SDK at runtime. Imports are type-only.
- Talk to oclif. The flag parser runs upstream; this block only knows about descriptor shapes.
- Handle file uploads. File inputs are staged by the resolver's file pipeline.
- Handle object-array assembly. That's Block 4 (Object Collector).

The function is pure: same input → same output, no side effects, no I/O.

## Public API

```ts
export function coerceToDescriptor(
  raw: unknown,
  descriptor: ParamDescriptor,
): unknown;

export function camelToKebab(s: string): string;
export function kebabToCamel(s: string): string;
```

## Error policy

| Failure | Throws |
|---|---|
| User-supplied value invalid for the descriptor | `UsageError` — message cites the offending value and the constraint |
| File or object kind reached this block | `Error` (not `UsageError`) — internal contract violation, the caller routed the value to the wrong place |
| Empty string passed to `camelToKebab` / `kebabToCamel` | `Error` — internal contract violation |

`UsageError` surfaces to the user as a clean CLI error. Plain `Error` surfaces as a stack trace — meant for developers, not users.

## Tests (coercion.test.ts)

- **Name conversion**: representative cases for each function + a property-based round-trip across the 36 SDK descriptor keys listed in the audit.
- **Each descriptor kind** has its own `describe` block: happy path, every rejection path, error-message content.
- **Boundary values**: min, max, exactly `maxLength`, exactly `minLength`.
- **Edge cases**: `NaN`, `null`, undefined pass-through, range with `undefined` default.

100% line and branch coverage.

## File layout

```
02-coercion/
├── README.md           ← this file
├── coercion.ts         ← functions + types (type-only SDK import)
├── coercion.test.ts    ← per-kind cases + round-trip property
```

No snapshot file — every assertion checks a specific value, not a serialized blob.

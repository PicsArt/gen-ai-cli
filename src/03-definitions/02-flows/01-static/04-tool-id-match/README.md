# Tool ID Match

Small primitive for flow predicates that need to discriminate on `model.toolId` patterns.

## Why this exists

For flows tied to a coarse SDK `InputType` (e.g. `t2v`), the predicate is one line. For flows that subset an InputType (e.g. `remove-bg`, `enhance`, `upscale` — all inside `i2i`), the predicate also needs to match on the model's `toolId`.

That would be straightforward if `toolId` were always a plain string. It's not — the SDK lets a model declare a `ToolIdMapping`:

```ts
type ToolIdMapping =
  | string
  | { by: 'audio' | 'audioUrl'; on: ToolIdMapping; off: ToolIdMapping }
  | { by: 'resolution' | 'quality' | 'duration' | ...; map: Record<string, ToolIdMapping> };
```

The mapping can be nested (e.g. `by: resolution` whose `map` values are themselves `by: audio` splits).

Flow predicates only care whether **any** leaf matches a pattern — "is this an upscaler regardless of resolution?" — so this primitive flattens the tree.

## API

```ts
flattenToolIds(mapping: ToolIdMapping | undefined): readonly string[]
//   Returns every leaf string. Empty array for undefined or unrecognized shapes.

hasToolIdMatching(model: ModelDefinition, pattern: RegExp): boolean
//   Convenience: regex.test() against any leaf.
```

## Typical use in a flow

```ts
import { hasToolIdMatching } from '../../../01-static/04-tool-id-match/tool-id-match.ts';

modelFilter: (m) =>
  m.inputType === 'i2i' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /\.(picsart-sod|removebg)/i),
```

## File layout

```
04-tool-id-match/
├── README.md              ← this file
├── tool-id-match.ts       ← flattenToolIds + hasToolIdMatching
└── tool-id-match.test.ts  ← all three ToolIdMapping shapes + nesting
```

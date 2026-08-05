# Flow Spec

The type contract every CLI command lives by. One file, one type, plus a tiny `defineFlow()` identity helper for ergonomic flow authoring.

## What a FlowSpec looks like

```ts
{
  id: 'generate',
  description: 'Generate an image or video from a prompt',
  modelFilter: (m) => m.capabilities.includes('text-to-image'),
  staticFlagGroups: ['universal', 'output', 'model'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['prompt'],
  defaultModel: 'flux-1.1-pro',
  examples: ['gen-ai generate -p "a sunset"'],
}
```

Each FlowSpec is pure data. No closures over runtime state, no I/O. The composer reads it (plus the Param Surface catalog) to build the final flag set and wizard step list for that command.

## Fields

| Field | Type | Required | Purpose |
|---|---|---|---|
| `id` | `string` | yes | CLI command name (`gen-ai <id>`); also unique key in the registry. Lowercase kebab-case. |
| `description` | `string` | yes | Help-text summary for `gen-ai --help` and `gen-ai <id> --help`. |
| `modelFilter` | `(m: ModelLike) => boolean` | yes | Picks which models this flow can run on. Composer applies it to `Models.list()` to derive the id set for `filterCatalog`. |
| `staticFlagGroups` | `readonly StaticFlagGroupName[]` | yes (can be `[]`) | Named groups from `01-static-flags`. Spread into the command's flag set. |
| `staticStepGroups` | `readonly StaticStepGroupName[]` | yes (can be `[]`) | Named groups from `01-static-steps`. Spliced into the wizard step list. |
| `requiredInputs` | `readonly RequiredInput[]` | yes (can be `[]`) | What the user must supply before the flow runs. Drives both wizard pre-steps and resolver validation. |
| `defaultModel` | `string` | no | Fallback when the user doesn't pass `-m`. Must satisfy `modelFilter` — not checked at module load. |
| `examples` | `readonly string[]` | no | Example invocations for `--help` output. One full command line per entry. |

## RequiredInput

```ts
type RequiredInput = 'prompt' | 'image' | 'video' | 'audio';
```

Extend this union when a new kind of user-supplied input appears. The resolver and the wizard's pre-steps both consume it.

## `defineFlow()` — identity helper

Plain pass-through. Exists for one reason: when a flow file does `export default defineFlow({ ... })`, TS narrows the literal at the call site and surfaces type errors right where you wrote the spec — not at the importer that consumes it later. Same trick `as const` would do, except `as const` won't widen function signatures correctly.

```ts
import { defineFlow } from '../01-flow-spec/flow-spec.ts';

export default defineFlow({
  id: 'generate',
  // ...
});
```

## What this sub-part does NOT do

- **Hold any flow declarations.** Those live in `02-registry/02-flows/`. This file is type-only.
- **Validate FlowSpec values.** The type system does the work. Runtime validation belongs to the composer or a future linter.
- **Know about composition.** That's `03-compose/`. This sub-part just defines the contract.

## File layout

```
01-flow-spec/
├── README.md             ← this file
├── flow-spec.ts          ← FlowSpec interface + RequiredInput + defineFlow()
└── flow-spec.test.ts     ← realistic specs compile + defineFlow passthrough
```

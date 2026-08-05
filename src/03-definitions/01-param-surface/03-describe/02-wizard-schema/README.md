# Wizard Schema (describe → wizard steps)

The describe-half twin of `flag-schema`. Walks a Catalog and emits a declarative `WizardStep[]` that the CLI's interactive prompter consumes. Prompt-library agnostic — inquirer, prompts, enquirer, or a custom TUI can all read it.

The symmetric inverse — turning answers back into a generation context — lives in `04-interpret/02-wizard-reader/` (future).

## What it does

For each `ParamSurface` in catalog order, picks the right step kind based on the descriptor:

| `descriptor.kind` | Produces |
|---|---|
| `text` | `{ kind: 'text', minLength?, maxLength? }` |
| `enum<string>` | `{ kind: 'select', choices: [{id,label}], default? }` |
| `enum<number>` | `{ kind: 'select', choices: [{id,label}], default? }` — numeric ids preserved |
| `range` | `{ kind: 'number', min, max, default? }` |
| `boolean` | `{ kind: 'confirm', default? }` |
| `file` | **skipped** (file pipeline owns these) |
| `object` | `{ kind: 'object', fields: WizardStep[], arrayMax? }` — recursive |

## Required flag

The `required` flag carries different meaning at different levels — but the rule the runner enforces is the same: "the runner must not let the user skip this step."

- **Top-level steps**: `required` is true when any model declares this param required (`surface.requiredInModels.length > 0`).
- **Subfield steps inside an object**: `required` is true when the subfield has **no default**. This matches the interpret-half's rule: when the user populates `--shot-prompt` but omits `--shot-duration` at index 1, the reader throws because `duration` has no default. The wizard runner enforces the same constraint up-front by re-prompting.

## Order

Steps appear in `catalog.all()` order with file descriptors filtered out. wizard-schema bakes in no UX opinions about ordering (e.g. "prompt first, seed last"). Reordering, inserting non-descriptor steps (model picker, output config, preview), and conditional branching are all jobs for a downstream composition / runner block. Keeping wizard-schema pure means a new SDK param appears in the wizard automatically and in a stable place.

## Composition (out of scope for this sub-part)

A downstream block will do:

```ts
const allSteps = [
  ...preSteps,                                  // model picker, mode picker
  ...generateWizardStepsFromCatalog(modelSub),  // ← this block's output
  ...postSteps,                                 // output / save / history
];
```

Want to insert "preview before submit" mid-flow? Splice it at the composition layer. Want a step that branches on a previous answer? The runner threads an `answers` object and can skip/re-prompt.

## Label resolution

Same rule as flag-schema's `description`: first non-empty per-model label wins; fallback is the camelCase key.

## Public API

```ts
import { generateWizardStepsFromCatalog, type WizardStep } from './wizard-schema.ts';

generateWizardStepsFromCatalog(catalog: Catalog): readonly WizardStep[]
//   walks every non-file surface, emits one step in catalog order;
//   recurses into object descriptors to build nested `fields`
```

## File layout

```
02-wizard-schema/
├── README.md                ← this file
├── wizard-schema.ts         ← kind-table dispatch + recursive object walker
└── wizard-schema.test.ts    ← 17 it-blocks across all kinds + required + labels + order
```

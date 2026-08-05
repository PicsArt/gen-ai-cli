# Wizard Flow Composer

The wizard-side twin of `01-flag-set/`. Reads a `FlowSpec` plus runtime data and produces the final ordered `WizardStep[]` the wizard runner walks.

## Pipeline

```
   FlowSpec ────────────┐
                        │
   Models.list() ──────►├── modelFilter ──► matching models (full objects)
                        │          │                │
                        │          │                ▼
                        │          │       build model-picker step (runtime data)
                        │          ▼
   Catalog ─────────────┼─► allowed-id Set ──► filterCatalog ──► narrowed catalog
                        │                                                │
                        │                                                ▼
                        │                                  wizard-schema → descriptor steps
                        │
                        └─► STATIC_STEP_GROUPS[name] × N ──► static steps
                                                                  │
                                                                  ▼
                              [ picker, ...descriptors, ...static groups in spec order ]
```

## Where the model picker comes from

The model picker is built **here**, not in `static-steps`. Reason: its `choices` are the runtime list of matching models — wizard-runtime data, not module-load data. Static = "fully self-contained at module load," which the picker isn't.

The picker carries:
- `kind: 'select'`, `key: 'model'`, `required: true`
- one `{ id, label }` per matching model (label is `model.name`, falling back to `model.id`)
- `default` resolved as: `flow.defaultModel` first, else the lone matching model when there's exactly one, else `undefined`

When zero models match, the picker is omitted entirely. Static groups still appear so the runner can fail loudly downstream (the flow has nothing to run on but the wizard isn't responsible for that diagnosis).

## Why this composition order

```
1. model picker   — user must pick before per-param questions make sense
2. descriptor steps — per-param prompts for the chosen model space
3. static groups  — output destination, confirmation gate (in spec order)
```

The runner can pre-fill the picker when there's only one match and skip prompting; descriptor steps that don't apply to the chosen model can be skipped at runtime by the runner. Composer's job is just "the full ordered list of *possible* steps for this flow."

## Pure function, all deps injected

```ts
composeWizardForFlow(
  flow: FlowSpec,
  catalog: Catalog,
  models: readonly ModelDefinition[],
): readonly WizardStep[]
```

No singletons. Same shape as `composeFlagsForFlow` for symmetry — CLI bootstrap can call both with the same args.

## What this composer does NOT do

- **Run the wizard.** That's the wizard runner (downstream block / layer).
- **Branch on previous answers.** Steps are emitted unconditionally; the runner can skip at runtime.
- **Apply UX ordering** (e.g. "prompt first, seed last"). It emits in catalog order. A future composition layer could reorder if needed.
- **Read answers back into a ctx.** Param Surface's `wizard-reader` does that.

## File layout

```
02-wizard-flow/
├── README.md             ← this file
├── wizard-flow.ts        ← composeWizardForFlow + model-picker builder
└── wizard-flow.test.ts   ← no-match / picker / descriptors / order / static groups
```

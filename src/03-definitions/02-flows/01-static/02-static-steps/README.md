# Static Steps

The wizard-side twin of `01-static-flags/`: pure data. Hand-maintained groups of `WizardStep`s that the SDK never declares — output destination prompts, confirmation gates.

Every FlowSpec references these by **group name**. The wizard composer splices the named groups into the final `WizardStep[]` alongside the descriptor-derived steps from Param Surface's `wizard-schema`.

## Why hand-maintained

These steps prompt for behaviors the *CLI* invents — "save to Drive?", "where to download?", "proceed?". The SDK doesn't (and shouldn't) prompt for them. Keeping them here, in plain data, makes them visible, diffable, and trivial to add to.

## Current groups

| Group | When to use | Steps |
|---|---|---|
| `output` | Any flow that produces a downloadable asset | `downloadPath` (text), `saveToDrive` (confirm, default true), `driveFolder` (text) |
| `confirm` | Add a yes/no gate before kicking off generation | `proceed` (confirm, required, default true) |

## What's deliberately NOT here

**The model picker.** Its `choices` come from the filtered model list at compose time, so it's not fully self-contained at module load. It lives next to the wizard composer (in `03-compose/02-wizard-flow/`), where the catalog is in scope.

Static = "fully self-contained, no runtime data needed." Anything that needs the catalog or models list belongs to the composer.

## Adding a step

1. Pick the right group (or add a new one).
2. Declare the step as a plain `WizardStep` literal — same shape Param Surface's `wizard-schema` produces.
3. If you added a new group, also add it to the `STATIC_STEP_GROUPS` const and the `StaticStepGroupName` type widens automatically.
4. Reference the group from any FlowSpec that needs it via `staticStepGroups: ['output', 'confirm', ...]`.

## Naming rules

- **`key` is camelCase** (matches descriptor ctx keys and Param Surface's `WizardStep.key`).
- **No key collisions across groups.** A test asserts each step `key` appears in at most one group — composers concat groups together, so a duplicate would silently shadow earlier answers.
- **Don't shadow descriptor keys.** If the SDK declares `aspectRatio`, don't add a static step with that key — Param Surface's `wizard-schema` already emits one. Static steps are for *prompts the SDK doesn't know about*.

## Public API

```ts
import { STATIC_STEP_GROUPS, getStaticStepGroup, type StaticStepGroupName } from './static-steps.ts';

STATIC_STEP_GROUPS.output     // raw access
getStaticStepGroup('confirm') // typed lookup — unknown names are a compile error
```

## What it does NOT do

- **Compose a wizard flow.** That's `03-compose/02-wizard-flow/`. This sub-part is data only.
- **Drive prompts.** The runner consumes the composed step list and prompts the user. Static-steps is just the input that comes from outside the descriptor space.
- **Know about specific commands.** A FlowSpec references groups by name; this file doesn't know which flows use which.

## File layout

```
02-static-steps/
├── README.md             ← this file
├── static-steps.ts       ← STATIC_STEP_GROUPS + getStaticStepGroup
└── static-steps.test.ts  ← group shape + per-group keys + no-collisions + type compat
```

# Workflow Match

Small primitive for flow predicates that need to discriminate models by backend workflow.

## Why this exists

For flows tied to a coarse SDK `InputType` (e.g. `t2v`), the predicate is one line. For flows that subset an InputType (e.g. `remove-bg`, `enhance`, `upscale` — all inside `i2i`), the predicate also needs to know **which operation** the model performs.

SDK 5 exposes that as a flat `workflow: string` on every model — the backend workflow the model executes:

```
recraft-vectorize      → 'recraft/v1/images/vectorize'
picsart-sod-v8-2       → 'pcp/v2/sod'
topaz-upscale-image    → 'topaz/upscale/image'
```

(The pre-SDK-5 `toolId` mapping tree this block used to flatten no longer exists.)

## Why the model id participates

Some vendors reuse one workflow for several operations — every seedance edit/extend variant ships workflow `"seedance"`. There the id (`seedance-2.0-video-extend` vs `seedance-2.0-video-edit`) is the only discriminator, so `matchesWorkflowOrId` tests the pattern against **both** the workflow and the id.

## API

```ts
matchesWorkflowOrId(model, /upscale/i)  // → boolean
```

Used by the sub-category flow specs in `02-registry/02-flows/`.

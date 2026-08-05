# `gen-ai generate` — universal entry point

The umbrella flow. Accepts any non-disabled model, regardless of InputType or toolId sub-category. Specialized flows (`image`, `video`, `music`, …) remain the preferred way to invoke a known category — `generate` is for discovery and one-off use.

## Discriminator

```ts
modelFilter: (m) => m.disabled !== true
```

No InputType or toolId narrowing. Every other flow narrows; this one doesn't.

## Inputs

None at the flow level. What the user must supply is decided by the chosen model's `paramConfig` at runtime. The registry-level test (`_flows.test.ts`) exempts this flow from the "must require ≥1 input" rule.

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocations

```
gen-ai generate                                # interactive picker
gen-ai generate -m flux-1.1-pro -p "a fox in the woods"
gen-ai generate -m veo-3 -p "neon-lit city street"
```

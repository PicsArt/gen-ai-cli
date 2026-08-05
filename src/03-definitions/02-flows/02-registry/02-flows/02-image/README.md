# `gen-ai image` — text-to-image

Covers every t2i model (flux, sd, ideogram, recraft, gemini, qwen, dalle, seedream, picsart-genai, ...).

## Discriminator

```ts
modelFilter: (m) => m.inputType === 't2i' && m.disabled !== true
```

## Inputs

- **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocations

```
gen-ai image -p "a watercolor of a fox in the woods"
gen-ai image -m flux-1.1-pro -p "modern logo, geometric"
```

# `gen-ai edit-image` — prompt-driven editing

i2i sub-category — flux-kontext, qwen-image-edit, qwen-edit-plus, qwen-makeup, gemini-2.5-flash-image, seedream edit, ...

Distinct from `remove-bg`, `change-bg`, `enhance`, `upscale`, `vectorize` which use task-fixed tools.

## Discriminator

```ts
modelFilter: (m) =>
  m.inputType === 'i2i' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /\.(flux-kontext|qwen-image-edit|qwen-edit-plus|qwen-makeup|gemini-2\.5-flash-image|seedream.*edit|image-edit)/i)
```

## Inputs

- **image** (required) · **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai edit-image -i photo.png -p "make the sky look like a sunset"
```

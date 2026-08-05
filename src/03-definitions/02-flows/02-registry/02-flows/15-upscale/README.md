# `gen-ai upscale` — resolution increase

i2i sub-category — Topaz, Recraft creative/crisp-upscale, Bytedance upscaler. Use `enhance` for quality-only restoration.

## Discriminator

```ts
modelFilter: (m) =>
  m.inputType === 'i2i' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /\.(.*upscale|topaz-upscale|bytedance-upscaler)/i)
```

## Inputs

- **image** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai upscale -i small.png
```

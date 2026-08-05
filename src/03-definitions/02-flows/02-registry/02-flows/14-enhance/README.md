# `gen-ai enhance` — perceptual restoration

i2i sub-category — Picsart enhance, Topaz enhance variants. Improves quality without changing resolution. Use `upscale` to increase resolution.

## Discriminator

```ts
modelFilter: (m) =>
  m.inputType === 'i2i' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /\.(picsart-enhance|topaz-enhance|enhance(?!.*upscale))/i)
```

## Inputs

- **image** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai enhance -i blurry-photo.jpg
```

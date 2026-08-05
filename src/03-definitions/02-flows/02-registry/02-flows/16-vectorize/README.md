# `gen-ai vectorize` — raster → vector

i2i sub-category — Recraft vectorize and `recraftvN-vector` variants.

## Discriminator

```ts
modelFilter: (m) =>
  m.inputType === 'i2i' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /(vectorize|-vector\b)/i)
```

## Inputs

- **image** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai vectorize -i logo.png
```

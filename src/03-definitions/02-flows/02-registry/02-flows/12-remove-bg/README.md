# `gen-ai remove-bg` — background removal

i2i sub-category — covers Picsart SOD and similar bg-removal tools.

## Discriminator

```ts
modelFilter: (m) =>
  m.inputType === 'i2i' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /\.(picsart-sod|removebg|remove-bg)/i)
```

## Inputs

- **image** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai remove-bg -i photo.png
```

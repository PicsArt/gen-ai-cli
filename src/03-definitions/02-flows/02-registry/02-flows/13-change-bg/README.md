# `gen-ai change-bg` — background replacement

i2i sub-category — Picsart change-bg, Recraft replace-bg, ...

## Discriminator

```ts
modelFilter: (m) =>
  m.inputType === 'i2i' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /\.(picsart-change-bg|replace-bg|change-bg)/i)
```

## Inputs

- **image** (required) · **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai change-bg -i photo.png -p "neon-lit city street at night"
```

# `gen-ai multi-image` — multi-reference scenes / frames

i2i sub-category — Pika scenes/frames, Kling multi-image / elements.

## Discriminator

```ts
modelFilter: (m) =>
  m.inputType === 'i2i' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /\.(multi-|pika-scenes|pika-frames|kling-elements|elements)/i)
```

## Inputs

- **image** (required, multi) · **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai multi-image -i a.png -i b.png -p "the two characters meeting in a cafe"
```

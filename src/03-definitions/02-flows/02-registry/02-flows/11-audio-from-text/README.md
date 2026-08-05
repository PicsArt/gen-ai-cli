# `gen-ai audio-from-text` — generic text → audio

Catch-all for `t2a` models that don't fit `text-to-speech`, `music`, or `sfx`.

## Discriminator

```ts
modelFilter: (m) => m.inputType === 't2a' && m.disabled !== true
```

## Inputs

- **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai audio-from-text -p "ambient drone, low frequency"
```

# `gen-ai sfx` — text → sound effect

Covers elevenlabs-sfx, ...

## Discriminator

```ts
modelFilter: (m) => m.inputType === 'sfx' && m.disabled !== true
```

## Inputs

- **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai sfx -p "footsteps on wet pavement, slow tempo"
```

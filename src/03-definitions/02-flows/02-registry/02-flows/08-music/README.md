# `gen-ai music` — text → music

Covers lyria, minimax-music, ...

## Discriminator

```ts
modelFilter: (m) => m.inputType === 'music' && m.disabled !== true
```

## Inputs

- **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai music -p "uplifting cinematic orchestral, 90 BPM"
```

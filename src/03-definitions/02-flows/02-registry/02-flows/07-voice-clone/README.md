# `gen-ai voice-clone` — speech-to-speech

Transform speech into a different voice. Covers eleven-voice-design, eleven-sts.

## Discriminator

```ts
modelFilter: (m) => m.inputType === 'sts' && m.disabled !== true
```

## Inputs

- **audio** (required) — the speech to transform

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai voice-clone -a sample.mp3
```

# `gen-ai text-to-speech` — text → speech

Covers elevenlabs, gemini-tts, openai-tts, grok-tts, minimax-02-hd, kling-t2a.

## Discriminator

```ts
modelFilter: (m) => m.inputType === 'tts' && m.disabled !== true
```

## Inputs

- **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocations

```
gen-ai text-to-speech -p "Welcome to the demo, friend."
gen-ai text-to-speech -m elevenlabs-v3 -p "Hello world"
```

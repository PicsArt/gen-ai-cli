# `gen-ai video-audio` — video-to-audio (dub / lipsync)

Add a generated audio track to an existing silent video. Covers kling-v2a.

## Discriminator

```ts
modelFilter: (m) => m.inputType === 'v2a' && m.disabled !== true
```

## Inputs

- **video** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai video-audio --video silent.mp4 -p "city ambience with distant traffic"
```

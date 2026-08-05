# `gen-ai talking-photo` — audio-driven photo animation

Audio → video: drive a still photo with a voice track. Covers kling-avatar, heygen-talking-photo, hailuo+audio, bytedance-omnihuman, creatify, runway-avatar-video, veed-fabric.

## Discriminator

```ts
modelFilter: (m) => m.inputType === 'a2v' && m.disabled !== true
```

## Inputs

- **image** (required) · **audio** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai talking-photo -i portrait.png -a speech.mp3
```

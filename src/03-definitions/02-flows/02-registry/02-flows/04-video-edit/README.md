# `gen-ai video-edit` — video-to-video

Edit / restyle / transform an existing video. Covers runway-aleph, wan-video-edit, seedance-video-edit, ltx-retake, kling-motion-control, ...

## Discriminator

```ts
modelFilter: (m) => m.inputType === 'v2v' && m.disabled !== true
```

## Inputs

- **video** (required) · **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai video-edit --video clip.mp4 -p "make it look like an oil painting"
```

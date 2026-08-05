# `gen-ai extend` — extend an existing video

v2v sub-category — VEO, Sora-2, LTX, Grok extension models. Formally `inputType: 'v2v'`, but the toolId names the operation explicitly.

## Discriminator

```ts
modelFilter: (m) =>
  m.inputType === 'v2v' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /\.(.*extend|extend.*)/i)
```

## Inputs

- **video** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocations

```
gen-ai extend --video clip.mp4
gen-ai extend -m veo-3-extend --video clip.mp4 -p "a sudden gust of wind"
```

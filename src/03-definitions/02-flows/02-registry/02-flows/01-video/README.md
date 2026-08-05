# `gen-ai video` — text-to-video

Covers every t2v model the SDK exposes (kling, veo, sora, seedance, hailuo, ltx, wan, pika, luma, hunyuan, runway, grok, happyhorse, ...).

## Discriminator

```ts
modelFilter: (m) => m.inputType === 't2v' && m.disabled !== true
```

`inputType === 't2v'` is the SDK's own classification — any model the vendor catalog declares with that tag flows through here automatically. No hardcoded id list.

## Inputs

- **prompt** (required) — the text description of the desired video

## Static groups

- Flags: `universal`, `output`, `model`
- Wizard steps: `output`, `confirm`

## Sample invocations

```
gen-ai video -p "a serene sunset over the ocean"
gen-ai video -m kling-v2-master -p "a bustling city skyline at night"
```

## How a new model joins this flow

Drop the model into the SDK catalog (`src/vendors/catalog/<vendor>.ts` in the `pa-gen-ai-sdk` repo) with `inputType: 't2v'` and bump the `@picsart/ai-sdk` pin here. Param Surface picks it up; the predicate above accepts it; `gen-ai video -m <new-id>` works on the next CLI startup. No file in this folder changes.

## File layout

```
01-video/
├── README.md       ← this file
├── video.ts        ← VIDEO_FLOW = defineFlow({ ... })
└── video.test.ts   ← shape + filter coverage (accepts t2v, rejects others, respects disabled)
```

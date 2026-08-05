# `gen-ai image-to-video` — animate a still image

Covers every i2v model (kling, hailuo, luma-flash2, pika, runway-gen45, veo, wan, sora, ...).

## Discriminator

```ts
modelFilter: (m) => m.inputType === 'i2v' && m.disabled !== true
```

## Inputs

- **image** (required) · **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocations

```
gen-ai image-to-video -i photo.png -p "slow zoom in"
gen-ai image-to-video -m kling-i2v -i scene.jpg -p "wind blowing through grass"
```

# `gen-ai character` — character-consistent generation

i2i sub-category — ideogram-character, runway-gen4-ref. Uses reference images to keep a subject identity consistent across outputs.

## Discriminator

```ts
modelFilter: (m) =>
  m.inputType === 'i2i' &&
  m.disabled !== true &&
  hasToolIdMatching(m, /\.(ideogram-character|runway-gen4-ref|character)/i)
```

## Inputs

- **image** (required) — reference of the character/subject
- **prompt** (required)

## Static groups

Flags: `universal`, `output`, `model` · Wizard steps: `output`, `confirm`

## Sample invocation

```
gen-ai character -i hero.png -p "the same person, in a snowy forest"
```

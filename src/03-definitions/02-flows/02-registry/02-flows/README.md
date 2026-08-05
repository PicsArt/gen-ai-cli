# Flow Declarations

One sub-folder per CLI command (= one `FlowSpec`). The Flows composer (`03-compose/`) reads these to build the final flag set + wizard step list per command.

## Convention

```
02-flows/
  NN-<id>/                  ← lowercase kebab-case, NN keeps ordering deterministic
    <id>.ts                 ← exports `<ID>_FLOW = defineFlow({...})` + default
    README.md               ← discriminator + inputs + samples
    <id>.test.ts (optional) ← deeper coverage, see 01-video for the exemplar
  _flows.ts                 ← barrel: { id: spec } map, exported as FLOWS
  _flows.test.ts            ← registry-level contract tests for every entry
```

Numbered prefixes (`01-`, `02-`, ...) are display order, not load order — `_flows.ts` is the source of truth for which flows exist.

## Inputs taxonomy

Each flow declares which user-supplied inputs are required:

- **prompt** — a text prompt
- **image** — one or more image files (resolver uploads)
- **video** — one or more video files
- **audio** — one or more audio files

Combinations are fine — `talking-photo` requires `['image', 'audio']`, `image-to-video` requires `['image', 'prompt']`.

## Discriminator pattern

For pure-shape flows (one SDK `InputType` = one flow), the predicate is one line:

```ts
modelFilter: (m) => m.inputType === '<t2v|i2v|tts|...>' && m.disabled !== true
```

For finer-grained flows that subset an InputType (e.g. `remove-bg` inside `i2i`), the predicate combines `inputType` with `toolId` / `id` checks. Those are added in a later batch.

## Current registry

### InputType-only (one InputType ⇒ one flow)

| id | InputType | Inputs |
|---|---|---|
| `video` | t2v | prompt |
| `image` | t2i | prompt |
| `image-to-video` | i2v | image, prompt |
| `video-edit` | v2v | video, prompt |
| `talking-photo` | a2v | image, audio |
| `text-to-speech` | tts | prompt |
| `voice-clone` | sts | audio |
| `music` | music | prompt |
| `sfx` | sfx | prompt |
| `video-audio` | v2a | video |
| `audio-from-text` | t2a | prompt |

### Sub-category (InputType + toolId pattern via `tool-id-match`)

| id | InputType | toolId pattern | Inputs |
|---|---|---|---|
| `remove-bg` | i2i | `picsart-sod`, `removebg` | image |
| `change-bg` | i2i | `picsart-change-bg`, `replace-bg` | image, prompt |
| `enhance` | i2i | `picsart-enhance`, `topaz-enhance` | image |
| `upscale` | i2i | `*-upscale`, `bytedance-upscaler` | image |
| `vectorize` | i2i | `vectorize`, `-vector` | image |
| `edit-image` | i2i | `flux-kontext`, `qwen-*-edit`, `gemini-flash-image`, ... | image, prompt |
| `character` | i2i | `ideogram-character`, `runway-gen4-ref` | image, prompt |
| `multi-image` | i2i | `multi-*`, `pika-scenes`, `pika-frames`, `*-elements` | image, prompt |
| `extend` | v2v | `*-extend`, `extend-*` | video |

## Adding a new flow

1. Pick the next `NN-<id>/` folder.
2. Write `<id>.ts` exporting `<ID>_FLOW = defineFlow({...})` + default.
3. Write a short `README.md` (this folder is the template).
4. Add one line to `_flows.ts`.
5. Run `npx vitest run src/blocks/flows` — `_flows.test.ts` auto-includes the new entry.

---
name: gen-ai-images
description: Generate images via the Picsart gen-ai CLI or MCP server. AUTO-TRIGGER whenever the user asks to generate, create, render, make, illustrate, or design an image, hero, product shot, OG image, poster, icon set, avatar, background, thumbnail, illustration, wallpaper, ad creative, social tile, lifestyle shot, or packshot; wants to pick between Flux / Recraft / Nano Banana / Imagen / Seedream / Ideogram / Hunyuan; wants to resize, reframe, upscale, remove background, replace background, or batch-process images.
---

# Image generation with gen-ai (CLI & MCP)

This skill covers **every image generation task** you can accomplish via the Picsart gen-ai CLI or the `@picsart/gen-ai-mcp` MCP server. Both call the same backend — pick whichever is closer to where you're working.

## When to use

Activate whenever the user asks to:

- Generate / render / create / make / illustrate an image
- Produce a hero, OG image, poster, icon, avatar, background, thumbnail, social tile, ad creative, lifestyle shot, or packshot
- Pick between Flux, Recraft, Nano Banana, Imagen, Seedream, Ideogram, or Hunyuan
- Resize / reframe / upscale / replace or remove a background
- Batch-process a directory of images
- Swap a product's background, recolor a product, composite a product into a scene
- Generate brand-consistent variants from a reference image

## CLI vs MCP — both work

- **Use the CLI** when it's installed (`gen-ai --version` works) and you're scripting in a terminal, CI, or piping JSON.
- **Use the MCP server** (`@picsart/gen-ai-mcp`) when the user is in Claude Code, Codex, Cursor, Windsurf, or ChatGPT and the CLI isn't installed — the MCP exposes the same capabilities as native tool calls. Ask in plain English; the agent calls `gen-ai_generate` directly.

Throughout this skill, each recipe shows the CLI form. When invoked via MCP, the agent translates the same arguments into a `gen-ai_generate` tool call — identical behavior.

## Model selection cheat sheet

Prefer family aliases over exact version pins whenever possible — `recraft-v4` always resolves to the latest stable within the family, so your scripts stay forward-compatible as new models ship. Run `gen-ai models` to see what's current.

| Model / alias | Strength | Typical cost | When to pick |
|---|---|---|---|
| `recraft-v4` | Design-forward, posters, editorial, on-brand art | ~2c | **Default for marketing visuals**, OG images, editorial |
| `recraft-v4-vector` | Clean SVG output | 2c | Logos, app icons, onboarding illustrations |
| `recraft-v4-pro` | Higher-fidelity Recraft | 4c | Premium hero art, print |
| `flux-2-pro` | Photoreal, strong prompt adherence | 1c | **Default for photoreal** — product, lifestyle, portrait |
| `flux-2-max` | Flagship photoreal | 2c | Hero art where realism must not break |
| `nano-banana` (gemini-2.5-flash-image) | Fast, cheap | 1c | Thumbnails, previews, throwaway variants |
| `nano-banana-pro` (gemini-3-pro-image) | Stronger composition | 2c | Polished Gemini renders |
| `imagen-4.0` | Google photoreal | 2c | Alt to Flux when Flux refuses a prompt |
| `seedream-5.0-lite` / `seedream-4.5` | Stylized, creative | 1-2c | Illustrative, brand-forward art |
| `ideogram-v3` | Text-in-image, posters, signage | 1c | Anything that must contain readable text |
| `ideogram-character` | Consistent subject across renders | 1c | Headshots, mockups, POD, mascots |
| `hunyuan-v3` | Tencent model, varied styles | 1c | Asian-market styles |
| `qwen-image-edit-plus` | Edit in place, text/motif swaps | 1c | Recolor, localize, seasonal refresh |
| `recraft-replace-bg` | Background replace only | 2c | Catalog styling, lifestyle compose |
| `topaz-upscale-image` | 4K upscale | varies | Print, press, post-gen polish |

**Future-proofing:** if the user names a model directly, honor it. Otherwise pick by intent. New models land in the Picsart registry continuously — use `gen-ai models` (or the MCP tool `gen-ai_list_models`) to see what's available right now.

## Quick decision tree

```
Photoreal product / lifestyle?        → flux-2-pro         (flux-2-max if premium)
Editorial / poster / brand art?       → recraft-v4         (recraft-v4-pro if premium)
Must contain readable text?           → ideogram-v3
Logo or scalable icon?                → recraft-v4-vector
Keep a face / subject consistent?     → ideogram-character (pass -i ref.png)
Swap background only?                 → recraft-replace-bg (pass -i product.png)
Recolor / localize existing image?    → qwen-edit-plus     (pass -i source.png)
Fast throwaway / preview?             → nano-banana
Need 4K or print-ready?               → topaz-upscale-image post-gen
Unsure?                               → gen-ai models compare flux-2-pro recraft-v4, then run candidate prompts
```

## Prompting best practices

### The five-slot recipe

Every good image prompt covers **subject, composition, lighting, style, and technical constraints**. Missing any one produces generic output.

1. **Subject.** Be specific — not "mug" but "ceramic mug, matte finish, handle on right."
2. **Composition.** Framing and angle — "centered, shallow depth of field, 3/4 angle, 50mm."
3. **Lighting.** "Editorial side-light with soft shadow," "neon magenta rim-light," "golden-hour natural light."
4. **Style.** Declare it. "Editorial magazine photography," "flat vector illustration," "photoreal product photography," "dark cinematic."
5. **Technical.** Aspect, materials, surface, palette. "Walnut table surface, deep navy background #0A1628."

### Family-specific tricks

| Family | What it responds to | Avoid |
|---|---|---|
| Flux | Photographic terms — "50mm, f/1.8, soft key-light, neutral grade" | Heavy stylized adjectives |
| Recraft | Style words — "editorial, magazine, minimalist, high contrast" | Camera settings (ignored) |
| Nano Banana | Short, concrete, 1-2 sentences | Long paragraph prompts |
| Imagen | Scene-focused, natural language | Style-word stacks |
| Ideogram | Spell every on-image word in escaped quotes: `"headline reads: \"Generate anything\""` | Vague text direction |
| Seedream | Stylized adjectives — "dreamy, surreal, cinematic" | Strict photoreal prompts |
| Qwen Edit Plus | Declare what to change; preserve what to keep | Re-describing the whole scene |

### Brand colors & dark-mode assets

- **Brand colors**: include hex codes explicitly. `"background #121212, magenta #FF47FF and cyan #00FFED gradient accents"`.
- **Dark mode**: don't rely on the model to read CSS tokens. Say `"dark background #121212, high contrast, neon accents"`.
- **Negative prompts**: `--negative-prompt "text, watermark, extra limbs, logo, signature"` — works on Flux, Recraft, Imagen.

### Aspect ratios by use case

| Use | `--ar` |
|---|---|
| OG image, Twitter card, LinkedIn share | `1200x630` |
| LinkedIn card | `1200x627` |
| IG post, Shopify PDP square | `1:1` |
| IG story, reel thumbnail, TikTok | `9:16` |
| LP hero (16:9), YouTube thumbnail | `16:9` |
| Shopify PDP hero, Etsy listing | `4:5` |
| Print poster | `2:3` |
| App icon | `1:1` (output as SVG via `recraft-v4-vector`) |

## Common recipes

### Single hero, 16:9, photoreal

```bash
gen-ai generate -m flux-2-pro \
  -p "editorial hero — ceramic espresso cup on walnut counter, morning light, shallow depth of field, brand palette magenta #FF47FF and cyan #00FFED rim-light" \
  --ar 16:9 --json --no-input | jq -r '.url' | xargs curl -L -o hero.webp
```

**Ask in chat (MCP):**
> "Render a 16:9 editorial hero of a ceramic espresso cup on a walnut counter with morning light. Use Flux 2 Pro. Save as hero.webp."

### OG image with readable title text

```bash
gen-ai generate -m ideogram-v3 \
  -p "editorial poster, the headline reads: \"Generate anything from your terminal.\", dark background, magenta and cyan type, center-aligned" \
  --ar 1200x630 --json --no-input | jq -r '.url' | xargs curl -L -o og.webp
```

### Six brand-consistent variants from a reference

```bash
gen-ai generate -m recraft-v4 -i hero.webp --count 6 --ar 1:1
```

Pass `-i <reference>` whenever brand consistency matters — it locks palette, composition, and mood across the whole variant set, much better than re-describing.

### Consistent face across multiple renders

```bash
gen-ai generate -m ideogram-character -i selfie.png \
  -p "linkedin headshot, id photo, editorial portrait, casual outdoor" \
  --count 4 --ar 1:1
```

### Batch — replace background across a product catalog

```bash
gen-ai generate --input-dir ./catalog/raw -m recraft-replace-bg \
  -p "soft studio gradient, warm natural light" \
  --batch --download ./catalog-styled
```

### Color / material variants from one packshot

```bash
gen-ai generate -m qwen-edit-plus -i hero.png \
  -p "red, navy, olive, cream" --count 4
```

### Localize a hero across markets

```bash
cat > localize.json <<EOF
{
  "jobs": [
    {
      "id": "de",
      "model": "qwen-image-edit-plus",
      "imageUrls": ["hero.png"],
      "prompt": "Localize for Germany with a Bavarian Alps motif"
    },
    {
      "id": "ja",
      "model": "qwen-image-edit-plus",
      "imageUrls": ["hero.png"],
      "prompt": "Localize for Japan with a Kyoto bamboo motif"
    },
    {
      "id": "br",
      "model": "qwen-image-edit-plus",
      "imageUrls": ["hero.png"],
      "prompt": "Localize for Brazil with a Rio coastline motif"
    }
  ]
}
EOF
gen-ai batch run localize.json -o ./localized
```

### Agent-friendly JSON mode — URL out for piping

```bash
# Return one URL
gen-ai generate -m recraft-v4 -p "$PROMPT" --json --no-input | jq -r '.url'

# Cost per call
gen-ai pricing recraft-v4

# Pipe stdin
echo "$PROMPT" \
  | gen-ai generate -m recraft-v4 --json --no-input \
  | jq -r '.url' | xargs curl -L -o inline.webp
```

### Inline upscale after generation

```bash
gen-ai generate -m flux-2-pro -p "$HERO" --ar 16:9 --json --no-input \
  | jq -r '.url' | xargs curl -L -o hero.webp
gen-ai upscale -m topaz-upscale-image -i hero.webp --scale 4 --json --no-input \
  | jq -r '.url' | xargs curl -L -o hero-4k.webp
```

### Compare model schemas before committing

```bash
gen-ai models compare flux-2-pro recraft-v4
gen-ai models compare flux-2-pro imagen-4.0
```

## MCP / natural-language patterns

When the CLI isn't installed, the MCP server gives the agent the same capabilities via native tool calls. Good prompts to pass to Claude Code / Codex / Cursor / Windsurf / ChatGPT:

- *"Render a 16:9 editorial hero for the blog at ./draft.md using Flux. Save as hero.webp."*
- *"Generate 6 on-brand product tiles (1:1) from hero.webp with Recraft V4 — save to ./assets."*
- *"Replace the background on product.png with a warm marble studio scene. Keep the product pixel-accurate."*
- *"Make 4 color variants of hero.png in red, navy, olive, cream — keep lighting identical."*
- *"Read clipboard and render one inline visual that matches the paragraph."*
- *"Compare flux-2-pro, recraft-v4, and imagen-4.0 on this prompt; save all three and tell me which feels most on-brand."*

The agent should:

1. Call `gen-ai_pricing` first on any batch > 10 images and multiply by job count to confirm spend.
2. Call `gen-ai_whoami` once per session before the first generation.
3. Prefer `recraft-v4` default unless the user specifies photoreal (then `flux-2-pro`).
4. Pass the user's reference image via `-i` whenever one exists locally — don't re-describe it.
5. If the user names a file but it doesn't exist, ask for clarification rather than inventing a path.

## Cost control

Before any batch > 10 images, check pricing and validate the manifest:

```bash
gen-ai pricing flux-2-pro
gen-ai batch run manifest.json --dry-run
```

**Auto-proceed cost bands** (rule of thumb):

- Under $1 — just run.
- $1–$5 — run; note estimated cost in chat.
- $5–$20 — show estimate, ask for confirmation.
- Over $20 — show estimate, break into smaller batches, ask.

**Draft → final pattern**: generate all drafts with `nano-banana` (1c), only re-render approved ones with the flagship family. Cuts cost 5–10× with no quality loss on the final.

## Output hygiene

- **Resolution floor**: 1024×1024 for social; 1920×1080 for hero; 1200×630 for OG; 4K for print.
- **Format**:
  - `.webp` for web (smaller, lossy and lossless both work)
  - `.png` when alpha transparency is required
  - `.svg` for vector models (`recraft-v4-vector`)
- **Verify with a second model** if output looks off — providers have off-days. `gen-ai models compare <a> <b>` compares capabilities; run candidate generations explicitly for visual comparison.

## Brand governance

Commit a `brand.md` to the repo describing palette, typography, voice, icon style, and forbidden patterns. The CLI does not have a policy gate flag, so include those constraints in the prompt:

```bash
PROMPT="$(cat brand.md)

$PROMPT"
gen-ai generate -m flux-2-pro -p "$PROMPT" --json --no-input
```

Review results before shipping brand-sensitive work.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Blurry output | Raise resolution (`--ar 1920x1080` or `--scale 2`); switch to `*-pro` / `*-max` variant |
| Text is gibberish | Switch to `ideogram-v3`; put on-image words in escaped quotes |
| Wrong palette | Include hex codes explicitly; pass brand reference via `-i` |
| Subject drifts across variants | Switch to `ideogram-character` or `recraft-v4` with `-i reference` |
| Too expensive | Drop to `nano-banana` for drafts; re-render only finals with the flagship |
| Model rejects prompt | Check model capabilities with `gen-ai models info <id>` or try another model family |
| Unexpected watermark | Some free-tier models add them; switch to `flux-2-pro` or `recraft-v4` |
| Text in image should be localized | Pass `--locale <xx>` or add the translated text verbatim in the prompt |

## For agents

- **Always confirm auth** with `gen-ai whoami` (or the `gen-ai_whoami` MCP tool) before the first generation in a session.
- **Always check pricing** before batches > 10 images.
- **Default to Recraft V4** unless the user says photoreal.
- **Prefer reference images** (`-i`) whenever brand / subject consistency matters — beats re-describing.
- **Never hardcode a specific model version** when a family alias exists (`recraft-v4` beats `recraft-v4.0.7`).
- **Emit JSON via `--json --no-input`** when piping into another tool — never scrape logs.
- **Respect `brand.md`** if one exists in the repo — include relevant constraints directly in prompts.
- **If the CLI isn't installed and MCP is available**, call the MCP tool directly — don't tell the user to install the CLI unless they ask.

---
name: gen-ai-workflows
description: End-to-end multi-step creative pipelines with the Picsart gen-ai CLI or MCP server. AUTO-TRIGGER whenever the user describes an outcome that needs more than one generation — blog-to-visuals, campaign kits, catalog re-shoots, OG image services, launch kits, headshot studio, localize a campaign, ad-variant factory, product mockups, press-batch, seasonal refresh, pitch mockups, or client handoffs. Pick the matching workflow instead of emitting a single generate call.
---

# End-to-end workflows with gen-ai (CLI & MCP)

This skill covers multi-step creative pipelines that deliver a complete outcome with the current gen-ai CLI command set.

## Core patterns

Use these rules for every workflow:

1. **Check pricing first.** Use `gen-ai pricing <model>` and multiply by job count/duration before large runs.
2. **Validate batches.** Use `gen-ai batch run <manifest.json> --dry-run`.
3. **Start cheap, upgrade finals.** Draft with cheaper model families; rerender only approved finals with premium models.
4. **Lock identity with references.** Pass `-i hero.webp`, `--video clip.mp4`, or `--audio line.mp3` whenever consistency matters.
5. **Fold brand guidance into prompts.** If a repo has `brand.md`, read it and include the relevant constraints directly in prompts.
6. **Keep batch output local first.** Use `-o <output-dir>` and share or upload the approved files after review.
7. **Resume failed batches with the subcommand.** Use `gen-ai batch resume <output-dir>`.
8. **Use JSON for exact filenames.** For one-off generations, use `--json --no-input | jq -r '.url' | xargs curl -L -o <file>`.

## Workflow 1 — Blog-to-visuals

Input: a blog draft. Output: hero + 3 inline illustrations + OG image.

```bash
DRAFT="post.md"
OUT="assets"
mkdir -p "$OUT"

TITLE=$(grep -m1 '^#' "$DRAFT" | sed 's/^# //')
BRAND="$(cat brand.md 2>/dev/null || true)"
INTRO="$(sed -n '1,80p' "$DRAFT")"

gen-ai generate -m flux-2-pro \
  -p "$BRAND

Editorial 16:9 hero for: $TITLE. Context: $INTRO" \
  --ar 16:9 --json --no-input | jq -r '.url' | xargs curl -L -o "$OUT/hero.webp"

for i in 1 2 3; do
  gen-ai generate -m recraft-v4 \
    -p "$BRAND

Inline illustration $i for: $TITLE. Use a clear editorial visual metaphor from the draft." \
    --ar 1:1 --json --no-input | jq -r '.url' | xargs curl -L -o "$OUT/inline-$i.webp"
done

gen-ai generate -m ideogram-v3 \
  -p "$BRAND

Editorial poster, headline reads: \"$TITLE\", dark background, high contrast type" \
  --ar 1200x630 --json --no-input | jq -r '.url' | xargs curl -L -o "$OUT/og.webp"
```

## Workflow 2 — Campaign asset kit

Input: one brief. Output: email header + IG tiles + LP hero + ad variants.

```bash
cat > campaign.json <<EOF
{
  "jobs": [
    {
      "id": "email-header",
      "model": "flux-2-pro",
      "prompt": "$BRAND $BRIEF — email header",
      "aspectRatio": "3:1"
    },
    {
      "id": "ig-01",
      "model": "recraft-v4",
      "prompt": "$BRAND $BRIEF — square social tile",
      "aspectRatio": "1:1"
    },
    {
      "id": "lp-hero",
      "model": "flux-2-pro",
      "prompt": "$BRAND $BRIEF — landing page hero",
      "aspectRatio": "16:9"
    },
    {
      "id": "ad-vertical",
      "model": "recraft-v4",
      "prompt": "$BRAND $BRIEF — paid social ad",
      "aspectRatio": "9:16"
    }
  ]
}
EOF

gen-ai pricing flux-2-pro
gen-ai pricing recraft-v4
gen-ai batch run campaign.json --dry-run
gen-ai batch run campaign.json -c 4 -o ./campaign-output
```

## Workflow 3 — Catalog reshoot

Input: SKU CSV and raw product photos. Output: styled catalog images.

Have the agent convert the CSV into a manifest with one job per SKU:

```json
{
  "defaults": { "model": "recraft-replace-bg" },
  "jobs": [
    {
      "id": "sku-001",
      "imageUrls": ["raw/sku-001.png"],
      "prompt": "brand-safe lifestyle studio scene, preserve product shape and label"
    }
  ]
}
```

Then run:

```bash
gen-ai batch run catalog.json --dry-run
gen-ai batch run catalog.json -c 6 -o ./styled
```

If providers fail intermittently:

```bash
gen-ai batch resume ./styled -c 3
```

## Workflow 4 — OG image service

Input: any URL. Output: branded 1200x630 OG preview.

```bash
#!/bin/bash
URL="$1"
TITLE=$(curl -sL "$URL" | pup 'title text{}' | head -1)
BRAND="$(cat brand.md 2>/dev/null || true)"

gen-ai generate -m ideogram-v3 \
  -p "$BRAND

Editorial poster, headline reads: \"$TITLE\", dark #121212, magenta #FF47FF accent" \
  --ar 1200x630 --json --no-input | jq -r '.url'
```

For production, cache per URL in KV with a 24h TTL.

## Workflow 5 — Launch kit

Input: product idea. Output: hero + social variants + reel with soundtrack.

```bash
PRODUCT="ceramic espresso cup, matte charcoal finish, brand palette magenta + cyan"

gen-ai generate -m flux-2-pro -p "$PRODUCT — magazine editorial" --ar 16:9 \
  --json --no-input | jq -r '.url' | xargs curl -L -o hero.webp

gen-ai generate -m recraft-v4 -i hero.webp \
  -p "$PRODUCT — square social variant" --count 4 --ar 1:1 --download ./socials

gen-ai generate -m kling-motion-control-v3 -i hero.webp --duration 5 \
  --json --no-input | jq -r '.url' | xargs curl -L -o reel.mp4

gen-ai extend --video reel.mp4 --times 2 --ar 16:9 --download ./extended

# Replace <extended-video>.mp4 with the downloaded file name from ./extended.
gen-ai video-audio -m kling-v2a --video ./extended/<extended-video>.mp4 \
  -p "confident warm synth bed, 120bpm, uplifting. intro builds, drop at :10." \
  --json --no-input | jq -r '.url' | xargs curl -L -o launch-reel-with-sound.mp4
```

If the brief requires separate music stems, generate `minimax-music` separately and mix later in the user's editor or any available local media tool.

## Workflow 6 — Headshot studio

```bash
gen-ai upscale -m topaz-upscale-image -i selfie.jpg --scale 2 --json --no-input \
  | jq -r '.url' | xargs curl -L -o selfie-hd.png

gen-ai generate -m ideogram-character -i selfie-hd.png \
  -p "linkedin headshot, id photo, editorial portrait, casual outdoor" \
  --count 4 --ar 1:1 --download ./headshots
```

## Workflow 7 — Localize campaign

Create a manifest with one job per market:

```json
{
  "jobs": [
    {
      "id": "de-hero",
      "model": "qwen-image-edit-plus",
      "imageUrls": ["hero.webp"],
      "prompt": "Localize the visual for Germany; preserve brand palette and product"
    },
    {
      "id": "ja-hero",
      "model": "qwen-image-edit-plus",
      "imageUrls": ["hero.webp"],
      "prompt": "Localize the visual for Japan; preserve brand palette and product"
    }
  ]
}
```

```bash
gen-ai batch run localize.json -c 4 -o ./localized
```

## Workflow 8 — Seasonal refresh

```bash
cat > holiday.json <<EOF
{
  "defaults": { "model": "qwen-image-edit-plus" },
  "jobs": [
    {
      "id": "sku-001-holiday",
      "imageUrls": ["sku-001.png"],
      "prompt": "$BRAND holiday 2026 — warm festive props, soft snow, warm tungsten"
    },
    {
      "id": "sku-002-holiday",
      "imageUrls": ["sku-002.png"],
      "prompt": "$BRAND holiday 2026 — same treatment"
    }
  ]
}
EOF

gen-ai batch run holiday.json --dry-run
gen-ai batch run holiday.json -c 5 -o ./holiday
```

## Workflow 9 — Pitch mockups

```bash
cat > pitch.json <<EOF
{
  "defaults": { "model": "recraft-v4" },
  "jobs": [
    {
      "id": "pitch-hero",
      "prompt": "$(cat clients/acme/brand.md) pitch hero — editorial, $CLIENT launch concept",
      "aspectRatio": "16:9"
    },
    {
      "id": "pitch-tile",
      "prompt": "$(cat clients/acme/brand.md) product tile",
      "aspectRatio": "1:1"
    },
    {
      "id": "pitch-quote",
      "prompt": "$(cat clients/acme/brand.md) quote slide, large editorial type",
      "aspectRatio": "16:9"
    }
  ]
}
EOF

gen-ai batch run pitch.json -c 4 -o ./pitch
```

## Workflow 10 — Ad variant factory

For a small variant set, use `--count`:

```bash
gen-ai generate -m recraft-v4 -i hero.webp \
  -p "paid social variant, preserve palette and product identity" \
  --count 8 --ar 1:1 --download ./ad-variants
```

For 50+ variants, have the agent write a manifest with one explicit job per aspect, audience, and copy angle, then run:

```bash
gen-ai batch run variants.json -c 6 -o ./variants
jq '.jobs[] | {id, status, url}' ./variants/results.json > variants-summary.json
```

## Workflow 11 — Press batch

```bash
gen-ai batch run press.json -c 4 -o ./press-upscaled
```

Apply watermarks after download with whatever tool is available: a deck/editor overlay, ImageMagick, or ffmpeg if already installed. If no local media tools are available, keep the watermark in the prompt/design or hand off the source files.

## For agents

- Choose the closest workflow and adapt it to the user’s exact files.
- Use only supported CLI commands in generated instructions.
- Generate manifests as `{ "jobs": [...] }`.
- Use `gen-ai batch run`, `gen-ai batch resume`, `gen-ai models`, `gen-ai pricing`, and `gen-ai validate` as the stable automation primitives.
- Keep brand constraints inside prompts until the CLI ships a first-class policy gate.
- Read `results.json` for batch traceability instead of inventing audit/export commands.

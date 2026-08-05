---
name: gen-ai-video
description: Generate video via the Picsart gen-ai CLI or MCP server. AUTO-TRIGGER whenever the user asks to generate, create, render, make, or animate a video, clip, reel, trailer, product demo, motion graphic, animation, teaser, or ad spot; animate a still image; extend a clip; add a soundtrack; build a talking-head explainer; or pick between Sora / Kling / Veo / Runway / Luma / Hailuo / Pika / LTX / Wan / Seedance.
---

# Video generation with gen-ai (CLI & MCP)

Video is the most expensive modality — a single Sora 2 Pro call can exceed $5. This skill covers **how to produce video reliably and cost-effectively** via the Picsart gen-ai CLI or the `@picsart/gen-ai-mcp` MCP server.

## When to use

Activate whenever the user asks to:

- Generate a video, clip, reel, trailer, demo, teaser, or ad spot
- Animate a still image (image-to-video / I2V)
- Edit or re-style an existing video (video-to-video / V2V)
- Extend a short clip to a longer one
- Build a talking-head avatar / explainer
- Attach an AI-generated soundtrack to a clip
- Pick between Sora, Kling, Veo, Runway, Luma, Hailuo, Pika, LTX, Wan, or Seedance

## CLI vs MCP — both work

- **CLI** when installed — best for scripting, CI pipelines, and long-running extend chains.
- **MCP server** (`@picsart/gen-ai-mcp`) when the user is in Claude Code, Codex, Cursor, Windsurf, or ChatGPT and the CLI isn't installed — the agent calls `gen-ai_generate` and `gen-ai_extend` natively.

## Model selection cheat sheet

Use family aliases. `gen-ai models --mode video` shows what's current.

| Model / alias | Type | Strength | When to pick |
|---|---|---|---|
| `sora-2-pro` | T2V | Flagship OpenAI, strong narrative | Hero reels, story beats |
| `sora-2` | T2V | Cheaper Sora tier | Most high-quality T2V work |
| `veo-3.1` | T2V | Google flagship | Photoreal, complex scenes |
| `veo-3.1-fast` | T2V | Faster / cheaper Veo | Iteration, drafts |
| `kling-v3-pro` | T2V | Strong motion + camera control | Action, product shots |
| `kling-v3-standard` | T2V | Cheapest Kling | Drafts, previews, social reels |
| `kling-motion-control-v3` | I2V | Animate a still | Hero → reel |
| `kling-avatar` | I2V | Talking-head avatars | Explainers, product demos |
| `kling-v2a` | V2A | Sync audio to video | Add matched foley to a clip |
| `runway-gen4-ref` | I2V | Reference-based motion | On-brand animated shots |
| `runway-gen4.5` | T2V | Strong camera and lighting | Cinematic T2V |
| `runway-gen4-aleph` | V2V | Video-to-video edit | Reformat, style transfer, reframing |
| `luma-ray2-t2v` | T2V | Fast, stylized | Short reels |
| `luma-flash2-i2v` | I2V | Fast I2V | Social reels |
| `hailuo-2.3-pro` | T2V | MiniMax flagship | High-motion shots |
| `pika-2.2-scenes` / `pika-2.2-frames` | I2V | Composable shots | Multi-shot reels |
| `ltx-pro-t2v` | T2V | LTX-2, fast | Quick iteration |
| `wan-t2v` / `seedance-t2v` | T2V | Alt T2V providers | Provider diversity |
| `sora-2-extend` | V2V | Extend Sora clips | Longer Sora output |
| `bytedance-video-upscaler` | V2V | Upscale video | Post-gen polish |

**Future-proofing:** family aliases (`kling-v3-pro`, `sora-2`) survive model upgrades. When the user names a specific version, honor it. New T2V and I2V models land frequently — always check `list-models` before using a version pin.

## Quick decision tree

```
Hero / narrative / premium?            → sora-2-pro  or  veo-3.1        (check pricing first!)
On-brand product/campaign reel?        → runway-gen45-t2v  or  kling-v3-pro
Animate a still image?                 → kling-motion-control-v3  (pass -i hero)
On-brand animated from a reference?    → runway-gen4-ref           (pass -i ref.png)
Talking-head avatar / explainer?       → kling-avatar              (pass -i portrait)
Short draft / iteration?               → kling-v3-standard  or  luma-ray2-t2v
Restyle / reformat an existing clip?   → runway-aleph              (pass --video input.mp4)
Add music/foley to an existing clip?   → kling-v2a                 (pass --video clip.mp4)
Need longer than one call?             → gen-ai extend  --video clip.mp4 --times N --ar 16:9
Need 4K?                               → bytedance-upscaler post-gen
```

## Prompting best practices

### Shot, motion, mood — in that order

Video models read **motion first**, mood second, subject third. Lead with the camera.

1. **Camera / motion.** "Slow dolly in," "hand-held push-in," "subject-tracking pan right," "locked-off tripod, no motion."
2. **Shot type.** "Wide establishing," "medium close-up," "over-the-shoulder," "macro product detail."
3. **Subject + action.** "Barista pours a latte; steam rises."
4. **Mood / style.** "Cinematic, warm tungsten, golden hour, shallow depth of field."
5. **Duration cue.** State the duration in the prompt AND pass `--duration`. Models that don't respect `--duration` still honor "a 5-second clip" in the prompt.

### Rules of thumb

- **Short phrases beat run-ons.** 2–3 short phrases separated by commas outperform one long sentence.
- **Lock the subject** with a reference image whenever possible. `runway-gen4-ref` and `kling-motion-control-v3` beat any T2V for brand consistency.
- **Avoid contradictions.** "Static subject, fast-moving camera" confuses every model. Pick one.
- **Negative prompts**: `--negative-prompt "warped faces, extra limbs, watermark, text, morphing"` — still useful even on video.
- **Aspect + duration determine cost.** 16:9 / 5s is the cheapest safe default for social reels.

### Family-specific tips

| Family | Best for | Prompt style |
|---|---|---|
| Sora | Narrative continuity, multi-beat shots | Describe the beats in order: "first, …, then, …, finally, …" |
| Veo | Photoreal, complex scenes | Natural language, include lighting terms |
| Kling | Strong motion, product rotation | Put motion first: "camera orbits left around the product" |
| Runway | Cinematic, reference-based | Short directive phrases; pass reference via `-i` |
| Luma | Stylized, fast | Lean on mood words — "dreamy, surreal, slow-motion" |
| Hailuo | High motion | Describe action explicitly |
| Pika | Multi-shot composition | Name the shot sequence explicitly |

### Duration planning

Most models cap at 5–10 seconds per call. Build longer pieces with `gen-ai extend`. Pass `--ar` when extending local files so the workflow does not depend on local media probes:

```bash
gen-ai extend --video clip.mp4 --times 3 --ar 16:9   # chain 3 extensions (~7s each)
```

Each extend is billed separately — factor that into estimates.

## Common recipes

### T2V — 5s, 16:9 (cheapest safe default)

```bash
gen-ai generate -m kling-v3-standard \
  -p "slow dolly in, ocean waves at dusk, golden light, cinematic" \
  --duration 5 --ar 16:9 --json --no-input | jq -r '.url' | xargs curl -L -o reel.mp4
```

### T2V — premium hero reel

```bash
gen-ai pricing sora-2-pro --duration 8
gen-ai generate -m sora-2-pro \
  -p "first, establishing wide of a ceramic studio; then, slow push-in to a single espresso cup; finally, steam curls into frame" \
  --duration 8 --ar 16:9 --json --no-input | jq -r '.url' | xargs curl -L -o hero-reel.mp4
```

### I2V — animate a hero image

```bash
gen-ai generate -m kling-motion-control-v3 -i hero.webp \
  -p "slow parallax push-in, subtle camera drift, steam rises" \
  --duration 5 --json --no-input | jq -r '.url' | xargs curl -L -o hero-reel.mp4
```

### Reference-based brand motion

```bash
gen-ai generate -m runway-gen4-ref -i brand-ref.png \
  -p "camera dolly right, subject confident, warm studio light" \
  --duration 5 --ar 16:9 --json --no-input | jq -r '.url' | xargs curl -L -o brand-reel.mp4
```

### Talking-head avatar from a portrait

```bash
gen-ai generate -m kling-avatar -i portrait.png \
  -p "Welcome to Picsart. Let's build something together." \
  --duration 8 --json --no-input | jq -r '.url' | xargs curl -L -o explainer.mp4
```

### Extend a 5s clip to ~28s

```bash
gen-ai extend --video hero-reel.mp4 --times 3 --ar 9:16   # 3 × 7s tails ≈ 26s + original 5s
```

### Video-to-video edit (reformat / restyle)

```bash
gen-ai generate -m runway-aleph --video input.mp4 \
  -p "reframe 16:9 to 9:16, preserve subject centered, slight blur on edges" \
  --json --no-input | jq -r '.url' | xargs curl -L -o social.mp4
```

### Attach an AI soundtrack

```bash
# Option A: no local mixer needed; V2A writes matched audio into the video
gen-ai video-audio -m kling-v2a --video reel.mp4 \
  -p "confident warm synth bed with subtle foley, uplifting, 30s" \
  --json --no-input | jq -r '.url' | xargs curl -L -o reel-with-sound.mp4

# Option B: optional local mixer if you already have ffmpeg and separate stems
gen-ai generate -m minimax-music -p "confident warm synth, 120bpm, uplifting, 30s" \
  --json --no-input | jq -r '.url' | xargs curl -L -o music.mp3
ffmpeg -i reel.mp4 -i music.mp3 -c:v copy -map 0:v -map 1:a reel-with-music.mp4
```

### Upscale post-gen

```bash
gen-ai generate -m bytedance-upscaler --video reel.mp4 --scale 2 --json --no-input \
  | jq -r '.url' | xargs curl -L -o reel-4k.mp4
```

### End-to-end — photo → 30s reel with music

```bash
# 1. Animate the hero
gen-ai generate -m kling-motion-control-v3 -i hero.webp --json --no-input \
  | jq -r '.url' | xargs curl -L -o v.mp4

# 2. Extend twice (total ~21s)
gen-ai extend --video v.mp4 --times 2 --ar 9:16 --download ./extended

# 3. Add AI-matched music/foley without local media tools
# Replace <extended-video>.mp4 with the downloaded file name from ./extended.
gen-ai video-audio -m kling-v2a --video ./extended/<extended-video>.mp4 \
  -p "confident warm synth bed, 120bpm, uplifting, subtle product foley" \
  --json --no-input | jq -r '.url' | xargs curl -L -o final.mp4
```

## MCP / natural-language patterns

When the CLI isn't installed, the MCP server gives the agent the same capabilities. Good prompts:

- *"Animate hero.webp into a 10-second reel with Kling motion control. Add a MiniMax soundtrack. Save as reel.mp4."*
- *"Generate a cinematic 5s hero reel for a new ceramic cup product. Use Runway Gen 4.5."*
- *"Turn this portrait into a 8-second explainer avatar reading: 'Welcome to Picsart.' Use Kling Avatar."*
- *"Take reel.mp4 and reformat 16:9 → 9:16 preserving the subject. Use Runway Aleph."*
- *"Extend clip.mp4 by ~20 seconds with the same vibe."*
- *"Estimate first — then render a Sora 2 Pro hero shot 8 seconds 16:9. Show me the cost before spending."*

The agent must:

1. **Always check `gen-ai pricing` first** for any T2V, I2V, or extend operation. Video is expensive.
2. **Prefer `kling-v3-standard`, `luma-ray2-t2v`, or `veo-3.1-fast` for drafts**; only upgrade to `sora-2-pro` or `veo-3.1` for the final.
3. **Use I2V (reference-locked)** whenever the user has a hero or brand asset — never T2V alone if a reference is available.
4. **Pause and confirm** for any single call likely over $5 or batch likely over $20.

## Cost control

Always check pricing before spending on video:

```bash
gen-ai pricing sora-2-pro --duration 8
gen-ai pricing kling-v3-pro --duration 5
gen-ai pricing veo-3 --duration 7
```

**Rule-of-thumb per-clip cost:**

- Kling Standard / Luma / Hailuo — ~$0.30–$0.80
- Kling Pro / Veo Fast / Runway Gen 4.5 — ~$1–$2
- Sora 2 / Veo Flagship — ~$3–$5
- Sora 2 Pro / 10s+ extends — $5–$15+

**Draft → final pattern**: iterate on prompts with `kling-v3-standard` (cheap). Once the shot is right, regenerate the final with the flagship. Cuts cost 5–10×.

## Output hygiene

- **Container**: `.mp4` is the safe default. Some tools emit `.webm` — use `--format mp4` to force.
- **Duration**: social reels 5–15s; hero films 15–30s; demos 30–60s. Over 30s usually means chaining.
- **Aspect**: 16:9 for YouTube / LP; 9:16 for IG Story / TikTok / Shorts; 1:1 for feed posts.
- **Poster frame**: use the original hero image, an approved still, or a generated thumbnail for thumbnail / OG. Optional local extraction if ffmpeg is already available: `ffmpeg -ss 00:00:02 -i reel.mp4 -frames:v 1 poster.webp`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Subject morphs / warps | Switch to I2V (`-i reference.png`); reduce duration; use `runway-gen4-ref` |
| No motion / static | Put motion first in the prompt: "slow push-in, …" |
| Too much motion | Add "locked-off tripod, minimal motion" to the prompt |
| Wrong aspect | Pass `--ar 16:9` explicitly; some models ignore prompt-only aspect cues |
| Exceeds $5 per call | Switch to `kling-v3-standard` or `luma-ray2-t2v` for drafts; only upgrade finals |
| Extend produces a cut | Increase overlap in the base clip; some models need 1–2s of the tail for continuity |
| Face drifts in avatar | Use a higher-resolution portrait (1024×1024+); pass `kling-avatar` a front-facing reference |

## For agents

- **Always check pricing** before spending on video. A single Sora 2 Pro call can exceed $5.
- **Prefer Kling Standard / Luma / Veo Fast for drafts**; upgrade only the final cut.
- **If the user has a reference image**, use I2V (`runway-gen4-ref`, `kling-motion-control-v3`) — never T2V alone.
- **Default duration = 5s** at `kling-v3-standard` unless user specifies otherwise.
- **Default aspect = 16:9** unless the user names a social platform.
- **Never chain more than 3 extends** without warning the user — cost compounds.
- **If the CLI isn't installed and MCP is available**, call MCP tools directly.
- **Log every video generation** in `~/.gen-ai/history/` — expensive artifacts should never be lost.

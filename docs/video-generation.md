---
title: "gen-ai CLI — Video Generation Reference"
id: cli-video-generation
type: reference
tags: [cli, gen-ai, video, t2v, i2v, v2v, reference]
summary: "Generate videos from text, images, or other videos with the gen-ai CLI — the terminal equivalent of a vendor video-generation API, using CLI flags instead of HTTP calls."
status: active
last_verified: 2026-06-17
related:
  - "[cli-spec](cli-spec.md)"
  - "[cli-tutorial](cli-tutorial.md)"
  - "api-reference"
  - "video-input-apis"
  - "pricing-reference"
---
# `gen-ai` CLI — Video Generation Reference

Generate videos from **text prompts**, **images**, or **existing videos** using every video model Picsart supports — all from the terminal. This page is the CLI analogue of a vendor's *Video Generation API* reference: where a hosted API documents `POST`/queue/`GET` calls, this documents the **`gen-ai` commands and flags** that do the same work.

> **Why no HTTP here?** A hosted video API makes *you* own the request lifecycle — submit a job, poll its status, fetch the result, download the file. `gen-ai generate` collapses all of that into one command: it submits, polls with a live progress bar, and downloads for you. The sections below map each API concept (auth, queue, file inputs, input schema, output) onto its CLI equivalent.

The companion pages are [cli-spec](cli-spec.md) (full command + flag reference) and [cli-tutorial](cli-tutorial.md) (hands-on walkthrough). Model-level vendor quirks live in api-reference; the input/extend capability matrix is video-input-apis.

---

## Workflow types

Video models fall into three input shapes. The CLI exposes each as a dedicated operation command (and all of them route through the universal `generate`):

| Input type | Operation command | What it does | Example models |
|---|---|---|---|
| **`t2v`** — text→video | `gen-ai video` | Generate a clip from a prompt | Seedance 2.0, Kling V3, Sora 2 / Sora 2 Pro, Veo 3.1, Wan 2.7 |
| **`i2v`** — image→video | `gen-ai image-to-video` | Animate a still image | Kling Motion Control V3, Wan 2.7 I2V, Happy Horse 1.0 R2V |
| **`v2v`** — video→video | `gen-ai video-edit` · `gen-ai extend` | Transform / restyle / extend a video | Seedance 2.0 Video Edit, Wan 2.7 Video Edit, Seedance Video Extend |

As of 2026-06-17 the catalog has **58 video models** (23 `t2v`, 18 `i2v`, 16 `v2v`). Browse the live list anytime:

```bash
gen-ai models --mode video            # human-readable table
gen-ai models --mode video --json     # machine-readable (id, provider, inputType, workflow)
gen-ai models --input-type i2v        # filter to image-to-video only
```

---

## Top models

A curated starting set (full list via `gen-ai models --mode video`):

| Model | Provider | Type | Highlights |
|---|---|---|---|
| `seedance-2.0` | seedance | t2v | Reference image, start/end frame, native audio, up to 1080p, 4–15s |
| `seedance-2.0-fast` | seedance | t2v | Faster, lower-cost Seedance variant |
| `kling-v3` | kling | t2v | High-motion text-to-video |
| `sora-2-pro` / `sora-2` | openai | t2v | OpenAI Sora 2 family |
| `veo-3.1` | google | t2v | Google Veo 3.1 (chainable via `extend`) |
| `wan-2.7-t2v` | wan | t2v | Wan 2.7 text-to-video |
| `kling-motion-control-v3` | kling | i2v | Animate a still with motion control |
| `wan-2.7-i2v` | wan | i2v | Image-to-video |
| `seedance-2.0-video-edit` | seedance | v2v | Restyle / edit an existing clip |
| `seedance-2.0-video-extend` | seedance | v2v | Add seconds to a clip |

Inspect any model's full capabilities and parameters:

```bash
gen-ai models info seedance-2.0          # features, badges, params
gen-ai models info seedance-2.0 --json   # full paramConfig (scriptable)
gen-ai models compare kling-v3 veo-3.1   # side-by-side
```

---

## Quick start

The one-liner — the CLI equivalent of a vendor "subscribe to the queue" snippet:

```bash
# Text → video (submits, shows a progress bar, downloads on completion)
gen-ai video -m seedance-2.0 -p "a cat surfing a wave at golden hour"

# Image → video
gen-ai image-to-video -m kling-motion-control-v3 -p "slow zoom in" -i ./photo.jpg

# Video → video (restyle)
gen-ai video-edit -m seedance-2.0-video-edit -p "make it look like claymation" --video ./clip.mp4
```

Scriptable / non-interactive (no browser, no prompts — reads the env token, prints JSON):

```bash
gen-ai video -m seedance-2.0 -p "a neon city flyover" --script
# --script = --silent --quiet --json
```

Pipe a prompt from stdin (handy for long prompts or generated text):

```bash
cat prompt.txt | gen-ai video -m kling-v3 -s
echo "drone shot over a snowy ridge, cinematic" | gen-ai video -m veo-3.1 -q
```

---

## Authentication

The API-key analogue. Authenticate once; the token is stored and reused.

```bash
gen-ai login        # opens a browser for OAuth, stores the token
gen-ai whoami       # confirm who you're logged in as
gen-ai logout       # clear the stored token
```

For CI / headless use, set the token via environment instead of the browser flow, then pass `--script` (or `--silent`) so the CLI never tries to open a browser:

```bash
export PICSART_USERNAME=...      # or the token env your environment uses
gen-ai video -m seedance-2.0 -p "test" --script
```

See [cli-spec](cli-spec.md) §Auth for the exact env var names and token storage location.

---

## The queue — handled for you

A hosted API exposes three queue operations. The CLI performs all three inside `generate`:

| Vendor API concept | CLI equivalent |
|---|---|
| `submit` request → returns a `request_id` | `gen-ai video ...` enqueues the workflow job |
| `status` polling loop | Built-in poller with a live **progress bar** (model-specific ETA) |
| `result` fetch → response payload | Final video URL printed; auto-downloaded unless told otherwise |

You normally never see the request id or write a polling loop. Control the experience with these flags:

| Flag | Effect |
|---|---|
| *(default)* | Progress bar + status text on stderr; result downloaded to `./output` |
| `-q`, `--quiet` | Suppress info/progress lines (keep the result) |
| `-s`, `--silent` | Fully silent run |
| `--json` | Emit the result as JSON (request id, status, output URL, credits) |
| `--script` | `--silent --quiet --json` together — the canonical automation mode |
| `--no-download` | Don't download; just print the result URL |
| `--download <dir>` | Download to a specific directory (default `./output`) |

> Progress-bar internals (per-model ETA via `estimatedTime` / `editEstimatedTime`) are documented in product-features §Generation Progress Bar.

---

## File inputs

How references (the image to animate, the video to edit, an audio track) are supplied. A hosted API wants a public URL or base64; the CLI accepts **either a URL or a local path** and uploads local files for you before submitting.

| Flag | Aliases | SDK param | Notes |
|---|---|---|---|
| `--image`, `-i` | | `imageUrls` | Repeatable. Local files are uploaded first. Used for i2v, reference, start/end frames |
| `--video` | `--vd` | `videoUrls` / `videoUrl` | The source clip for v2v / edit / extend. Local file gets uploaded |
| `--audio`, `-a` | | `audioUrls` / `audioUrl` | Audio track (e.g. talking-photo, video→audio flows) |
| `--start-frame` | | `startFrame` | First frame still (Seedance keyframe control) |
| `--end-frame` | | `endFrame` | Last frame still (Seedance keyframe control) |

```bash
# Local file — auto-uploaded, then animated
gen-ai image-to-video -m wan-2.7-i2v -p "gentle parallax" -i ./hero.png

# Remote URL — passed straight through
gen-ai image-to-video -m wan-2.7-i2v -p "gentle parallax" -i https://example.com/hero.png

# Keyframe control: start + end frame
gen-ai video -m seedance-2.0 -p "morph between the two shots" \
  --start-frame ./a.jpg --end-frame ./b.jpg
```

> The SDK keys are plural (`imageUrls`, `videoUrls`, `audioUrls`); the CLI keeps the historic singular flag names (`--image`, `--video`, `--audio`) for script compatibility. See `aliases.ts` in `src/03-definitions/01-param-surface/01-primitives/01-aliases/`.

---

## Input schema (parameters)

The CLI's per-model **param surface** is the equivalent of a vendor's input schema. Every flag maps to an SDK param; validity (allowed enum values, ranges) is enforced by the model definition and ultimately by the pluggable worker. Inspect the exact surface for any model with `gen-ai models info <model> --json`.

### Common video parameters

These appear across most video models (exact options vary per model — always check `models info`):

| Flag | Aliases | SDK param | Type | Notes |
|---|---|---|---|---|
| `--prompt`, `-p` | | `prompt` | text | **Required.** The text prompt (or pipe via stdin) |
| `--negative-prompt` | `--neg`, `--neg-prompt` | `negativePrompt` | text | What to avoid |
| `--aspect-ratio` | `--ar` | `aspectRatio` | enum | e.g. `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`, `adaptive` |
| `--resolution`, `-r` | | `resolution` | enum | e.g. `480p`, `720p`, `1080p` |
| `--duration`, `-d` | | `duration` | enum/number | Clip length in seconds (e.g. Seedance `4`–`15`) |
| `--generate-audio` | `--audio-gen` | `generateAudio` | boolean | Produce a native audio track |
| `--seed` | | `seed` | number | Reproducible output (model-dependent) |
| `--cfg-scale` | `--cfg` | `cfgScale` | number | Prompt adherence strength |

### Example — `seedance-2.0` full surface

From `gen-ai models info seedance-2.0 --json`:

| Param | Flag | Required | Type | Allowed values |
|---|---|---|---|---|
| `prompt` | `-p` | ✅ | text | — |
| `aspectRatio` | `--ar` | | enum | `16:9` · `9:16` · `1:1` · `4:3` · `3:4` · `21:9` · `adaptive` |
| `resolution` | `-r` | | enum | `480p` · `720p` · `1080p` |
| `duration` | `-d` | | enum | `4`–`15` (integer seconds) |
| `generateAudio` | `--audio-gen` | | boolean | — |
| `returnLastFrame` | `--return-last-frame` | | boolean | Return the final frame as a still (for chaining) |
| `imageUrls` | `-i` | | file | Reference image(s) |
| `videoUrls` | `--video` | | file | Source video |
| `audioUrls` | `-a` | | file | Audio track |
| `startFrame` | `--start-frame` | | file | First-frame keyframe |
| `endFrame` | `--end-frame` | | file | Last-frame keyframe |

```bash
gen-ai video -m seedance-2.0 \
  -p "a fox running through autumn leaves, cinematic, shallow depth of field" \
  --ar 16:9 -r 1080p -d 8 --audio-gen
```

### Preview the resolved payload (the "dry run")

Before spending credits, see exactly which workflow and parameters would be submitted — the equivalent of inspecting a request body:

```bash
gen-ai video -m seedance-2.0 -p "test" -d 10 --dry-run
# Prints resolved workflow + payload without executing

# Validate a candidate payload against the model schema
echo '{"prompt":"test","duration":99}' | gen-ai validate -m seedance-2.0
gen-ai validate -m seedance-2.0 --file payload.json
```

---

## Output

What you get back, and where it goes.

```bash
# Default: video downloaded to ./output, URL printed
gen-ai video -m seedance-2.0 -p "test"

# JSON result (URL, status, credits, request id) — pipe-friendly
gen-ai video -m seedance-2.0 -p "test" --json | jq '.output'

# Save to Picsart Drive (smart filename + ffmpeg thumbnail, matching the app)
gen-ai video -m seedance-2.0 -p "test" --save-to-drive
gen-ai video -m seedance-2.0 -p "test" --drive-folder "My Project"

# Don't download — just emit the URL
gen-ai video -m seedance-2.0 -p "test" --no-download
```

| Flag | Effect |
|---|---|
| `--download <dir>` | Download directory (default `./output`) |
| `--no-download` | Skip download, print URL only |
| `--save-to-drive`, `--drive` | Upload result to Picsart Drive ("AI Playground" folder) with an LLM-generated filename and video thumbnail |
| `--drive-folder <name>` | Save into a named Drive subfolder |
| `--open` | Open the result in the default app |
| `--clipboard` | Copy the result URL to the clipboard |

---

## Image-to-video

Animate a still. The image is the primary input (`-i`); the prompt steers the motion.

```bash
# Motion control from a single image
gen-ai image-to-video -m kling-motion-control-v3 \
  -p "camera pushes in slowly, hair blowing in the wind" \
  -i ./portrait.jpg --ar 9:16

# Wan 2.7 image-to-video
gen-ai image-to-video -m wan-2.7-i2v -p "subtle parallax, drifting clouds" -i ./landscape.png
```

Check which models accept image input: `gen-ai models --input-type i2v`.

---

## Video-to-video (edit / restyle)

Transform an existing clip. The source is `--video`; the prompt describes the transformation.

```bash
# Restyle a clip
gen-ai video-edit -m seedance-2.0-video-edit \
  -p "convert to hand-drawn anime style" \
  --video ./input.mp4

# Wan 2.7 video edit
gen-ai video-edit -m wan-2.7-video-edit -p "add a snowy atmosphere" --video ./clip.mp4
```

Some video-edit models accept an `--audio-setting` flag controlling whether to preserve the source audio (`origin`) or let the model decide (`auto`) — see [cli-spec](cli-spec.md) for per-model flags.

---

## Extend a video

Add seconds to a clip by chaining continuation segments. Built for the Veo family (`+7s` per segment), and Seedance exposes dedicated extend workflows (`seedance-2.0-video-extend`).

```bash
# Extend a Veo video by one +7s segment
gen-ai extend --video ./clip.mp4 -p "the camera keeps panning right"

# Chain three extensions sequentially (+21s total)
gen-ai extend --video ./clip.mp4 -p "continue the motion" --times 3

# Preview without spending credits
gen-ai extend --video ./clip.mp4 --times 2 --dry-run
```

| Flag | Default | Notes |
|---|---|---|
| `--video` | | Video to extend (URL or local path) |
| `-m`, `--model` | `veo-3` | VEO model to use |
| `-p`, `--prompt` | | Continuation prompt |
| `--times` | `1` | Chain N extensions sequentially |
| `--aspect-ratio` | auto-detect | Override aspect ratio (local files auto-detect) |

Extend shares the same output flags as `generate` (`--download`, `--save-to-drive`, `--open`, `--clipboard`).

---

## Pricing

Estimate cost before generating — the credit equivalent of a vendor pricing page. Exact credits are resolved by `modelId` (catalog ranges via `@picsart/pa-model-pricing-sdk`) plus the backend `/options` call.

```bash
gen-ai pricing seedance-2.0 --duration 5 --resolution 1080p   # cost for a specific config
gen-ai pricing kling-v3 --duration 5                          # cost for a 5s clip
gen-ai pricing --mode video --json                            # all video model pricing
gen-ai credits                                                # your current balance
```

Cost drivers for video are typically **duration**, **resolution**, and **audio generation**. See pricing-reference for how `modelId`-keyed ranges and exact `/options` credits combine.

---

## See also

- [cli-spec](cli-spec.md) — full command + flag reference (every command, not just video)
- [cli-tutorial](cli-tutorial.md) — hands-on getting-started walkthrough
- api-reference — per-model vendor quirks and payload details
- video-input-apis — video input / extend capability matrix across providers
- pricing-reference — credit pricing model
- [video-generation](video-generation.md) — the product-level video generation overview (web app surface)

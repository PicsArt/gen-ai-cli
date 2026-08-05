---
name: gen-ai-use
description: |
  Generates AI images, videos, and audio via the gen-ai CLI (a Picsart API service).
  Covers single and batch generations, image operations (remove background, change
  background, enhance/upscale, vectorize), browsing models, checking pricing, Picsart
  Drive upload/download, VEO video extension, payload validation, piping/scripting,
  shell completions, and troubleshooting. Use when the user wants to generate an
  image, generate a video, create AI media, remove or change background, enhance or
  upscale an image, vectorize to SVG, browse available models, check gen-ai pricing,
  run batch generations, upload to or download from Picsart Drive, extend a video,
  or invokes "/gen-ai-use".

allowed-tools: Read, Bash, Grep, Glob
version: 1.1.0
---

# gen-ai CLI — Usage Guide

The `gen-ai` CLI generates AI images, videos, and audio from the terminal. It is a Picsart API service.

This is the full skill, with every section inlined. Downloaded copies don't need external files — everything you need is below.

## Install

One-liner (recommended) — downloads a prebuilt binary:
```bash
curl -fsSL https://picsart.com/gen-ai-cli/install.sh | bash
```

Or via npm:
```bash
npm install -g @picsart/gen-ai
```

Authentication is required for generation commands (uses Picsart login):
```bash
gen-ai login     # Authenticates with your Picsart account
gen-ai whoami    # Verify auth status
```

## Generate an image

```bash
# Interactive mode (prompts for model, params)
gen-ai generate

# Fully specified (non-interactive)
gen-ai generate --model flux-2-pro --prompt "a sunset over mountains" --no-download

# With an input image
gen-ai generate --model gemini-3.1-flash-image --image ~/photo.jpg \
  --prompt "make it watercolor style"

# Multiple images (models that support it)
gen-ai generate --model gpt-image-1.5 --image img1.jpg --image img2.jpg \
  --prompt "combine these"
```

## Generate a video

```bash
# Text-to-video
gen-ai generate --model kling-v3-pro --prompt "a cat playing piano" --aspect-ratio 16:9

# Image-to-video
gen-ai generate --model kling-v3-pro --image ~/photo.jpg --prompt "animate this scene"

# With duration
gen-ai generate --model veo-3.1 --prompt "ocean waves" --duration 5
```

## Image operations

```bash
# Remove background
gen-ai remove-bg --image photo.jpg
gen-ai remove-bg -i photo.jpg -m picsart-remove-bg -s

# Change background
gen-ai change-bg --image photo.jpg --prompt "tropical beach sunset"
gen-ai change-bg -i photo.jpg -p "studio with soft lighting" -m picsart-change-bg -s

# Enhance / upscale
gen-ai enhance --image photo.jpg
gen-ai enhance -i photo.jpg -m picsart-enhance -s
gen-ai enhance -i photo.jpg -m topaz-upscale-image -s

# Vectorize (raster to SVG)
gen-ai vectorize --image logo.png
gen-ai vectorize -i logo.png -m recraft-vectorize -s
```

Each operation command supports the same output flags as `generate`: `--download`, `--save-to-drive`, `--drive-folder`, `--open`, `--clipboard`, `--json`, `--quiet`, etc.

## Browse models

Model IDs change frequently as new versions ship. Always fetch the live catalog before committing to a specific model:

```bash
gen-ai models                                      # list all models
gen-ai models --mode image                         # filter by mode
gen-ai models --mode video
gen-ai models info <id>                            # capabilities, inputs, aspect ratios
gen-ai models compare <id-a> <id-b>                # side-by-side comparison
```

### Special input patterns

Some models accept non-standard inputs. Use `gen-ai models info <id>` to confirm what a specific model supports. Common patterns:

| Pattern | Flag usage |
|---------|------------|
| Multi-image (models that accept multiple inputs) | `--image` repeated (up to 14) |
| Start frame (i2v / keyframe video models) | `--image` (auto-mapped to startFrame) |
| End frame (Luma) | Prompted interactively after start frame |
| Image + audio (avatar / lipsync models) | `--image` + `--audio` |
| Image + video (motion-control models) | `--image` + `--video` |

## Check pricing

```bash
gen-ai pricing <model-id>
```

## Useful flags

### Generate flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--model` | `-m` | Model ID, name, or workflow |
| `--prompt` | `-p` | Generation prompt |
| `--prompt-file` | | Read prompt from file (multi-line) |
| `--image` | `-i` | Input image path or URL (repeatable) |
| `--video` | | Input video path or URL |
| `--audio` | | Input audio path or URL |
| `--duration` | `-d` | Video duration in seconds |
| `--aspect-ratio` | `--ar` | Aspect ratio (e.g. 16:9) |
| `--resolution` | `-r` | Resolution (e.g. 1080p) |
| `--count` | `-n` | Number of outputs |
| `--quality` | | Quality setting |
| `--style` | | Style preset |
| `--negative-prompt` | | Negative prompt |
| `--cfg-scale` | | CFG scale (guidance strength) |
| `--image-weight` | | Image weight (influence of input image) |
| `--generate-audio` / `--no-generate-audio` | | Enable/disable audio for video models |
| `--enhance-prompt` | | Enable prompt enhancement |
| `--voice` | | Voice selection for audio models |
| `--dry-run` | | Validate payload without executing |
| `--silent` | `-s` | Skip interactive prompts, use model defaults |
| `--json` + `--no-input` | | Machine-readable output with no interactive prompts |
| `--download <dir>` | | Download to directory (default: `./output`) |
| `--no-download` | | Don't download result |
| `--save-to-drive` / `--no-save-to-drive` | | Save to Picsart Drive (on by default) |
| `--drive-folder <name>` | | Drive subfolder (default: `gen-ai-cli`) |
| `--open` / `--no-open` | | Open result in default app |
| `--clipboard` | | Copy result URL to clipboard |
| `--bell` | | Play terminal bell on completion |
| `--notify` | | Send desktop notification on completion |

### Directory input flags (generate)

| Flag | Description |
|------|-------------|
| `--input-dir <dir>` | Use all files in directory as input |
| `--multi` | Multi-image mode (all files to one generation, max 14) |
| `--batch` | Batch mode (one generation per file) |
| `--type` | Filter input files: image, video, audio |
| `--max-files <n>` | Max input files (default: 30) |
| `--concurrency <n>` | Parallel batch jobs (default: 3) |

### Base flags (all commands)

| Flag | Alias | Description |
|------|-------|-------------|
| `--json` | | Output as JSON |
| `--plain` | | Plain tabular output (no formatting) |
| `--quiet` | `-q` | Suppress non-essential output |
| `--no-color` | | Disable color output |
| `--no-input` | | Disable all interactive prompts |
| `--debug` | | Show debug output |

## All commands

### Auth
```bash
gen-ai login          # OAuth browser login
gen-ai logout         # Clear stored credentials
gen-ai whoami         # Show current user
```

### Generation
```bash
gen-ai generate       # Generate image/video/audio (interactive or flags)
gen-ai remove-bg      # Remove background from an image
gen-ai change-bg      # Replace background using a prompt
gen-ai enhance        # Upscale or enhance an image
gen-ai vectorize      # Convert a raster image to SVG
gen-ai redo           # Re-run last generation (accepts generate flags as overrides)
gen-ai extend         # Extend a VEO video by +7s (chainable with --times)
```

### Models, pricing & credits
```bash
gen-ai models                    # List all models (filter with --mode, --provider)
gen-ai models info <id>          # Model capabilities, inputs, aspect ratios
gen-ai models compare <a> <b>    # Side-by-side comparison
gen-ai pricing <model-id>        # Credit cost for a model
gen-ai credits                   # Show current credit balance
gen-ai validate -m <id>          # Validate payload against model schema
```

### Batch
```bash
gen-ai batch run manifest.json   # Run batch jobs from manifest
gen-ai batch status <dir>        # Summary of a prior run
gen-ai batch resume <dir>        # Retry only failed jobs
```

### Drive
```bash
gen-ai upload <files>            # Upload to Picsart Drive
gen-ai download                  # Download from Picsart Drive
gen-ai list                      # List Drive files/folders
```

### Config
```bash
gen-ai config get <key>          # Get a setting
gen-ai config set <key> <value>  # Set a preference
gen-ai config list               # Show all settings
gen-ai config unset <key>        # Remove a preference
gen-ai config keys               # List valid config keys
```

### History
```bash
gen-ai history                   # Recent generations (default 20)
gen-ai history last              # Details of the last generation
gen-ai history files             # Recently used input files
gen-ai history clear             # Clear all history
```

### Utilities
```bash
gen-ai completion <shell>        # Shell completions (bash, zsh, fish)
gen-ai update                    # Self-update to latest version
```

Config is persisted to `~/.gen-ai/config.json`. Valid keys: `defaultModel`, `downloadDir`, `autoOpen`, `autoClipboard`, `autoBell`, `autoNotify`, `recentFilesCount`, `imagePreview`, `autoUpdate`.

## Important defaults

- **Drive auto-save**: Results are automatically saved to Picsart Drive in the `gen-ai-cli` folder. Use `--no-save-to-drive` to disable, or `--drive-folder NAME` for a custom folder.
- **startFrame mapping**: When passing `-i` / `--image` to a model that uses `startFrame` (VEO, Kling i2v, Wan, Luma, Seedance, Runway), the image is automatically mapped to `ctx.startFrame`.

---

# Batch generation

Run many `gen-ai` generations from a single manifest file.

## Batch workflow checklist

```
Batch run progress:
- [ ] Write manifest.json ({ defaults?, jobs[] })
- [ ] Validate with `gen-ai batch run manifest.json --dry-run`
- [ ] Execute with `gen-ai batch run manifest.json -c <n> -o <dir>`
- [ ] Inspect <dir>/results.json for entries where status !== "completed"
- [ ] Retry failures with `gen-ai batch resume <dir>`
- [ ] Summarize durations / success rate
```

## Batch commands

```bash
gen-ai batch run manifest.json                         # default concurrency = 3
gen-ai batch run manifest.json -c 20 -o ./out          # 20 parallel jobs, custom output dir
gen-ai batch run manifest.json --dry-run               # validate without executing
gen-ai batch resume ./out                              # retry only failed jobs
gen-ai batch status ./out/results.json                 # summary of a prior run
```

Key flags: `-c, --concurrency <n>` (default 3), `-o, --output <dir>` (default `./batch-output`), `--no-download` (skip file download), `--download-concurrency <n>` (default 3), `--dry-run`.

JSON is the safest manifest format. YAML is also accepted.

## Manifest schema

Top-level is `{ defaults?, jobs[] }`. Each job needs a unique `id`, a `model`, and a `prompt`. Any extra keys become per-job params and override `defaults`. Image-edit models accept `imageUrls: ["<local-path|url>"]`.

```json
{
  "defaults": { "aspectRatio": "1:1" },
  "jobs": [
    { "id": "hero",   "model": "flux-2-pro",             "prompt": "sunset over mountains", "aspectRatio": "16:9" },
    { "id": "cat",    "model": "gemini-3.1-flash-image", "prompt": "a cat in space" },
    { "id": "remix",  "model": "flux-kontext-pro",       "prompt": "make it watercolor",    "imageUrls": ["./src.jpg"] }
  ]
}
```

There is **no `count:` field** — to get N variants of the same prompt, emit N jobs with unique `id`s.

## Batch output

Per manifest: `<output>/<job-id>.<ext>` for each downloaded asset, plus `<output>/results.json` summarizing all jobs. Each job entry looks like:

```json
{ "id": "hero", "model": "flux-2-pro", "status": "completed",
  "url": "https://cdn-pipeline-output.picsart.com/...png",
  "durationMs": 22306, "localPath": "out/hero.png" }
```

`status` is `"completed"` on success (not `"success"`). Filter failures with `status !== "completed"`.

## Summarizing a run

```bash
node -e '
  const r = require("./batch-output/nb2-parallel/results.json");
  const jobs = r.jobs || [];
  const ok = jobs.filter(j => j.status === "completed");
  const durations = ok.map(j => j.durationMs).sort((a,b) => a-b);
  console.log(`${ok.length}/${jobs.length} ok`);
  console.log(`fastest ${(durations[0]/1000).toFixed(1)}s, slowest ${(durations.at(-1)/1000).toFixed(1)}s`);
'
```

---

# Picsart Drive (upload, download, list)

The `gen-ai` CLI can read from and write to Picsart Drive. Drive commands browse the real Drive root — all folders visible (AI Playground, Image Flow, AI Video Generator, and any other root folders the account has).

## Upload

```bash
gen-ai upload photo.jpg                                  # Single file
gen-ai upload photo.jpg --folder "Campaign Assets"       # To a specific folder
gen-ai upload ./renders/                                 # All media in a dir
gen-ai upload ./renders/ -r --type image                 # Recursive, images only
gen-ai upload ./renders/ --dry-run                       # Preview, don't upload
gen-ai upload *.jpg --max-files 100                      # Override 200-file limit
```

| Flag | Default | Description |
|------|---------|-------------|
| `--folder, -f` | AI Playground | Drive folder (interactive mode shows all root folders) |
| `--type, -t` | all | Filter: image, video, audio |
| `--recursive, -r` | false | Recurse into subdirectories |
| `--dry-run` | false | List files without uploading |
| `--max-files` | 200 | Safety limit on number of files |
| `--concurrency, -c` | 3 | Parallel uploads |

## Download

```bash
gen-ai download                                          # Interactive folder/file picker
gen-ai download --folder "Campaign Assets" --all         # All from a folder
gen-ai download --folder "AI Playground" --type video    # Filter by media type
gen-ai download --all -o ./local-assets/                 # Custom output dir
gen-ai download --list --type video                      # List as JSON, no download
```

| Flag | Default | Description |
|------|---------|-------------|
| `--folder, -f` | — | Root-level Drive folder name |
| `--all, -a` | false | Download all (vs. interactive pick) |
| `--list, -l` | false | List files as JSON (no download) |
| `--output, -o` | ./downloads | Local destination directory |
| `--type, -t` | all | Filter: image, video, audio |
| `--max-files` | 30 | Safety limit on downloads |
| `--concurrency, -c` | 3 | Parallel downloads |

## List

```bash
gen-ai list --folders                         # All root-level Drive folders
gen-ai list                                   # All AI Playground files with metadata
gen-ai list --folder "AI Playground"          # Files in a specific folder
gen-ai list --type video | jq '.[].model'     # Pipe to jq
gen-ai list --folders | jq '.[].name'         # Just folder names
```

## Generation → Drive in one step

`gen-ai generate` can push the result straight to Drive without a separate upload:

```bash
gen-ai generate --model <id> --prompt "..." --save-to-drive
gen-ai generate --model <id> --prompt "..." --drive-folder "My Project"   # implies --save-to-drive
```

---

# Advanced

Commands and modes that go beyond a single `gen-ai generate` call.

## Validate

Inspect the parameter schema for a model or check a payload before sending it. Useful for building manifests and debugging `"Invalid parameter"` errors.

```bash
gen-ai validate --model <id> --schema                    # Print parameter schema
echo '{"prompt":"test"}' | gen-ai validate --model <id>  # Validate via stdin
gen-ai validate --model <id> --file payload.json         # Validate from a file
```

## Extend (VEO video extension)

Extend a VEO video by +7 seconds per iteration. Chainable.

```bash
gen-ai extend --video ./clip.mp4 --ar 16:9                    # +7s extension
gen-ai extend --video ./clip.mp4 --model <veo-id> --ar 16:9   # Specific VEO model
gen-ai extend --video ./clip.mp4 --times 3 --ar 16:9          # Chain 3 extensions (+21s)
gen-ai extend --video ./clip.mp4 --download ./output --open --ar 16:9  # Download + open result
```

| Flag | Default | Description |
|------|---------|-------------|
| `--video` | (required) | Video file or URL to extend |
| `--model, -m` | (latest VEO) | Must be a VEO model |
| `--times` | 1 | Number of +7s extensions to chain |
| `--ar, --aspect-ratio` | auto when possible | Pass explicitly for local files so extension does not depend on ffprobe |

## Piping and scripting

The CLI is pipe-friendly. Stream separation: data → stdout, errors → stderr, spinners → stderr.

| Flag | Effect |
|------|--------|
| `-s, --silent` | Skip interactive prompts, use model defaults |
| `-q, --quiet` | Suppress info/success/spinner output (errors still on stderr) |
| `--json` | Output result as JSON to stdout |
| `--json --no-input` | Supported flag combination for clean pipe output |

When stdin is piped (not a TTY) and no `--prompt`/`--prompt-file` is given, the entire stdin is read as the prompt. In non-TTY mode, `--model` is required.

### Example pipelines

```bash
# URL only
gen-ai generate -m <image-id> -p "sunset" --json --no-input | jq -r '.url'

# Generate and download in one pipeline
cat prompt.txt | gen-ai generate -m <image-id> --json --no-input | jq -r '.url' | xargs curl -L -o out.png

# Loop over prompts
while IFS= read -r p; do
  gen-ai generate -m <image-id> -p "$p" --json --no-input >> results.json
done < prompts.txt

# Filter models to video-only, extract IDs
gen-ai models --json | jq '.[] | select(.mode=="video") | .id'
```

## CI / headless environments

For CI pipelines or environments without a browser, set these environment variables:

```bash
export PICSART_ACCESS_TOKEN="<your-access-token>"
export PICSART_USER_ID="<your-user-id>"
```

When both are set, the CLI skips the browser login entirely.

---

# Troubleshooting

## Dry-run to inspect the payload

Always the first diagnostic step. Validates parameters without sending the request and, with `--debug`, prints the full resolved payload:

```bash
gen-ai generate --model flux-2-pro --prompt "test" --dry-run --debug
```

## Common issues

| Issue | Solution |
|-------|----------|
| "Not authenticated" | Run `gen-ai login` |
| "Model not found" | Check exact ID with `gen-ai models` |
| "Invalid parameter" | Use `--dry-run` to validate params |
| Timeout on large video | Increase patience — video models can take minutes |
| "Credit insufficient" | Check balance with `gen-ai pricing <model>` |

## Batch-specific issues

1. Re-run the manifest with `--dry-run` to surface schema errors.
2. Inspect `<output>/results.json` and filter for `status !== "completed"` — failures carry the upstream error message.
3. Use `gen-ai batch resume <output>` to retry only the failed jobs.

---

# Example workflows

## Image → video

Start from an image, then animate it:

```bash
# Generate initial image
gen-ai generate --model flux-2-pro --prompt "cyberpunk cityscape at night"

# Turn it into a video
gen-ai generate --model kling-v3-pro --image ~/Downloads/result.png \
  --prompt "camera slowly pans across the city"
```

## Cross-model batch comparison

Run the same prompt against multiple image models side by side:

```bash
cat > /tmp/compare.json <<'JSON'
{
  "jobs": [
    { "id": "flux",    "model": "flux-2-pro",             "prompt": "a golden retriever in a field of sunflowers" },
    { "id": "gemini",  "model": "gemini-3.1-flash-image", "prompt": "a golden retriever in a field of sunflowers" },
    { "id": "gpt",     "model": "gpt-image-1.5",          "prompt": "a golden retriever in a field of sunflowers" }
  ]
}
JSON
gen-ai batch run /tmp/compare.json -c 3 -o ./compare-out
```

Results land in `./compare-out/<id>.<ext>` plus `./compare-out/results.json`.

---

# Shell completions

Generate tab-completion scripts for your shell.

```bash
# Bash — add to ~/.bashrc
eval "$(gen-ai completion bash)"

# Zsh — add to ~/.zshrc
eval "$(gen-ai completion zsh)"

# Fish — write directly to the completions directory
gen-ai completion fish > ~/.config/fish/completions/gen-ai.fish
```

After reloading your shell, tab-complete commands, subcommands, and flags.

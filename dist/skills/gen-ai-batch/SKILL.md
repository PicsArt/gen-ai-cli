---
name: gen-ai-batch
description: Batch generation, manifests, JSON output, and CI/CD integration with the Picsart gen-ai CLI or MCP server. AUTO-TRIGGER whenever the user asks to process many files or assets at once, run a manifest, render at scale, fan out variants, pipe output into jq / curl / next-build, wire generation into GitHub Actions / Vercel / Cloudflare Workers / cron, or automate content generation in CI.
---

# Batch, JSON output, and automation with gen-ai (CLI & MCP)

This skill covers how to run many generations at once and integrate them into pipelines with the current Picsart gen-ai CLI.

## When to use

Activate whenever the user wants to:

- Generate more than 5 assets in one run
- Feed a manifest, CSV-derived JSON, or directory to the CLI
- Pipe generation output into another script or CI step
- Build an automated content pipeline
- Schedule periodic content generation
- Produce per-row assets from a catalog, spreadsheet, or database export

## CLI vs MCP

- CLI batch work uses `gen-ai batch run <manifest.json>`.
- Failed batch jobs are retried with `gen-ai batch resume <output-dir>`.
- Machine-readable output for single generations uses `--json --no-input`.
- MCP hosts expose equivalent generation and batch tools, but agents should still mirror the CLI contract in examples.

## Manifest shape

The current CLI expects an object with a `jobs` array. `defaults` are merged into each job's generation context, and each job can override any default by setting the field itself.

```json
{
  "defaults": {
    "model": "recraft-v4"
  },
  "jobs": [
    {
      "id": "linkedin",
      "model": "recraft-v4",
      "prompt": "editorial LinkedIn hero, dark background, magenta and cyan accents",
      "aspectRatio": "1200x627"
    },
    {
      "id": "ig-post",
      "prompt": "square brand tile, clean editorial composition",
      "aspectRatio": "1:1"
    },
    {
      "id": "voiceover-en",
      "model": "eleven-multilingual-v2",
      "prompt": "Warm, confident read. Welcome to Picsart."
    }
  ]
}
```

Each job needs a stable `id`. Downloaded files are saved into the batch output directory with names derived from the job IDs and result URLs.

## Supported per-job fields

Use the same camelCase payload keys that the CLI sends to the SDK:

| Field | Notes |
|---|---|
| `id` | Required unique job ID |
| `model` | Model ID or alias from `gen-ai models` |
| `prompt` | Generation prompt |
| `negativePrompt` | Exclusions when supported by the model |
| `aspectRatio` | `16:9`, `1:1`, `9:16`, `1200x630`, etc. |
| `count` | Number of outputs when the selected model supports it |
| `imageUrls` | Reference image paths or URLs |
| `videoUrl` | Reference video path or URL |
| `audioUrl` | Reference audio path or URL |
| `duration` | Seconds for video/audio models that support it |
| `voiceId` | Voice ID for TTS models |

Validate exact model-specific fields with:

```bash
gen-ai models info <model-id>
gen-ai validate -m <model-id> --file payload.json
```

## Run a batch

```bash
gen-ai batch run manifest.json -c 4 -o ./batch-output
```

### Supported batch flags

| Flag | Purpose |
|---|---|
| `-c, --concurrency N` | Parallel jobs |
| `-o, --output <dir>` | Output directory for `results.json` and downloads |
| `--dry-run` | Validate manifest shape and model IDs without executing |
| `--no-download` | Skip local downloads |
| `--download-concurrency N` | Parallel download workers |
| `--json` | JSON command output where supported |
| `--quiet` | Suppress non-essential output |
| `--no-input` | Disable interactive prompts |

## Resume failed jobs

Batch resume is a subcommand, not a flag:

```bash
gen-ai batch resume ./batch-output -c 4
```

It reads `./batch-output/results.json`, finds failed jobs, reloads the original manifest path, and reruns only those jobs.

## Directory mode

For one operation across a folder of files:

```bash
gen-ai generate --input-dir ./raw -m recraft-replace-bg \
  -p "soft studio gradient, warm natural light" \
  --batch --concurrency 4 --download ./styled
```

The directory preflight creates an internal manifest and dispatches it through batch mode.

## JSON output for pipes

Use `--json --no-input` for clean stdout. Pair it with `jq` when saving exact filenames.

```bash
# URL only
gen-ai generate -m recraft-v4 -p "$PROMPT" --json --no-input | jq -r '.url'

# Download exact filename
gen-ai generate -m recraft-v4 -p "$PROMPT" --json --no-input \
  | jq -r '.url' | xargs curl -L -o hero.webp

# Pipe stdin as prompt
echo "$PROMPT" \
  | gen-ai generate -m recraft-v4 --json --no-input \
  | jq -r '.url' | xargs curl -L -o inline.webp
```

Batch runs always write `results.json` in the output directory:

```bash
gen-ai batch run jobs.json -o ./batch-output
jq '.jobs[] | {id, status, url}' ./batch-output/results.json
```

## CI / CD recipes

### GitHub Actions — regenerate OG image on merge

```yaml
name: OG image
on:
  push:
    branches: [main]
    paths: ['src/pages/**', 'public/og-prompt.txt']

jobs:
  og:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Install gen-ai CLI
        run: npm i -g @picsart/gen-ai
      - name: Verify auth
        env:
          PICSART_ACCESS_TOKEN: ${{ secrets.PICSART_ACCESS_TOKEN }}
          PICSART_USER_ID: ${{ secrets.PICSART_USER_ID }}
        run: gen-ai whoami
      - name: Check pricing
        run: gen-ai pricing recraft-v4
      - name: Generate OG
        run: |
          PROMPT="$(cat brand.md 2>/dev/null || true)

          $(cat public/og-prompt.txt)"
          URL=$(gen-ai generate -m recraft-v4 -p "$PROMPT" \
                  --ar 1200x630 --json --no-input | jq -r '.url')
          curl -L -o public/og.webp "$URL"
```

### Next.js build step — hero asset per release

```json
{
  "scripts": {
    "prebuild": "gen-ai generate -m flux-2-pro -p \"$HERO_PROMPT\" --ar 16:9 --download public"
  }
}
```

Gate generation with a cache key so it only regenerates when `$HERO_PROMPT` changes.

### Cron

```cron
0 9 * * 1 /usr/bin/gen-ai batch run $HOME/weekly-posts.json -c 4 -o "$HOME/gen-ai-weekly/$(date +\%Y-\%m-\%d)"
```

## Cost control

The CLI does not have a batch estimate command yet.

```bash
gen-ai pricing recraft-v4
gen-ai pricing kling-v3-pro --duration 5
gen-ai batch run manifest.json --dry-run
```

Use `pricing` for model credit ranges, `--dry-run` for manifest validation, and multiply by job count/duration before large runs.

## Brand guidance

The CLI does not have a policy gate flag. If a repo has `brand.md`, read it and include the relevant constraints directly in each prompt or prompt file before generation.

Example:

```bash
PROMPT="$(cat brand.md)

$HERO_PROMPT"
gen-ai generate -m flux-2-pro -p "$PROMPT" --ar 16:9 --json --no-input
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Batch says "No jobs in manifest" | Use `{ "jobs": [...] }`, not a flat array |
| Job missing model | Add `job.model` or `defaults.model` |
| Unknown model | Run `gen-ai models` or `gen-ai models info <id>` |
| Rate-limited | Lower `--concurrency` to 2 and rerun `gen-ai batch resume <output-dir>` |
| Provider error | Inspect `results.json`, then run `gen-ai batch resume <output-dir>` |
| Need exact output filenames | Use `--json --no-input` plus `curl -L -o`, or rename files after batch download |
| Manifest validation error | Run `gen-ai batch run manifest.json --dry-run` |

## For agents

- Use `gen-ai batch run <manifest.json>` for manifests.
- Use `gen-ai batch resume <output-dir>` for retries.
- Use `jobs`, not `items`, in manifests.
- Prefer `--json --no-input` for one-off scripts and `results.json` for batch scripts.
- Use `gen-ai pricing <model>` before large runs and report the rough multiplied cost.
- Fold `brand.md` constraints into prompts; do not invent unsupported policy flags.
- Never rely on per-job `out` paths, tags, retry flags, or batch estimate flags unless the CLI adds them.

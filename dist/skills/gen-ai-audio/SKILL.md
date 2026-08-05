---
name: gen-ai-audio
description: Generate audio via the Picsart gen-ai CLI or MCP server. AUTO-TRIGGER whenever the user asks to record / generate / create / produce a voiceover, voice-over, VO, narration, spoken line, ad read, explainer voice, podcast intro, audiobook snippet, dialogue, music track, backing track, jingle, sting, sound effect, SFX, UI sound, foley, or multi-language speech; or wants ElevenLabs voices, MiniMax Music, Kling T2A/V2A, speech-to-speech dubbing, or localized voiceovers.
---

# Audio generation with gen-ai (CLI & MCP)

Audio is the cheapest modality — typically cents per line — and the fastest to iterate on. This skill covers **every audio task** you can accomplish via the Picsart gen-ai CLI or the `@picsart/gen-ai-mcp` MCP server.

## When to use

Activate whenever the user asks to:

- Record / generate a voiceover, VO, narration, spoken line, ad read, or podcast intro
- Produce an explainer voice, audiobook snippet, dialogue, or character read
- Localize speech across languages
- Clone a voice or dub an existing line (speech-to-speech)
- Generate music — backing track, jingle, sting, loop
- Generate SFX — UI sounds, whooshes, impacts, ambiences
- Sync audio to a video (video-to-audio / foley)

## CLI vs MCP — both work

- **CLI** when installed — best for scripting multi-market batches, JSON output, and video-audio handoff.
- **MCP server** (`@picsart/gen-ai-mcp`) when the user is in Claude Code, Codex, Cursor, Windsurf, or ChatGPT and the CLI isn't installed — the agent calls `gen-ai_generate` natively.

## Model selection cheat sheet

Run `gen-ai models --mode audio` to see current models.

| Model / alias | Type | Strength | When to pick |
|---|---|---|---|
| `eleven-v3` | TTS | Highest-quality ElevenLabs voice | Hero voiceovers, ads, product intros |
| `eleven-multilingual-v2` | TTS | 32 languages, consistent voice across locales | Localized campaigns |
| `eleven-sts-v2` | STS | Speech-to-speech — same voice, new words | Dubbing, voice matching |
| `eleven-multilingual-sts-v2` | STS | Multilingual speech-to-speech | Localized dubbing |
| `elevenlabs-sfx` | SFX | Sound effects from text | UI sounds, stingers, Foley |
| `minimax-music-v2` | Music | Text-to-music (with structure) | Backing tracks, jingles, reels |
| `kling-t2a` | T2A | Alt text-to-audio | Provider diversity for music/SFX |
| `kling-v2a` | V2A | Generate audio that matches a video | Sync foley / ambient sound to a clip |

**Future-proofing:** when new audio models arrive (e.g., new ElevenLabs voice families), `gen-ai models --mode audio` reflects them. Honor specific voices/models the user names; otherwise pick by intent.

## Quick decision tree

```
Single voiceover line?                 → eleven-v3
Localized voiceover across markets?    → eleven-multilingual-v2 (batch)
Dub / voice-match an existing take?    → eleven-sts-v2   (pass --audio source.mp3)
Backing music for a reel?              → minimax-music
UI / foley sound effect?               → elevenlabs-sfx
Music-fill a video automatically?      → kling-v2a       (pass --video clip.mp4)
Produce a podcast intro?               → eleven-v3 + minimax-music stems; optional editor/local mix
```

## Prompting best practices

### Voice (TTS) — the character line is everything

Every VO prompt has **three layers**: voice character, delivery, and the text itself. Missing any one produces robotic output.

1. **Voice character**: `warm, calm, 30s female, mid-range, confident` — describe the persona you want.
2. **Delivery**: `measured pace, friendly` / `urgent, energetic` / `intimate, breathy`.
3. **The text**: end every sentence with proper punctuation. Commas and periods determine pacing. Ellipses = pause.

**Template:**
```
[VOICE_CHARACTER] [DELIVERY_NOTE] [TEXT]
```

**Example:**
```
warm, calm, 30s female, mid-range, confident. measured pace, friendly tone.

"Welcome to Picsart. Generate anything, from your terminal."
```

For ad reads: write short sentences. Voice models read punctuation literally — a long run-on sentence will rush.

### Music — genre, tempo, mood, structure

Specify all four:

1. **Genre**: `lo-fi piano`, `synthwave`, `orchestral`, `trap`, `acoustic folk`.
2. **Tempo**: BPM — `80bpm`, `128bpm`.
3. **Mood**: `melancholy`, `triumphant`, `meditative`, `tense`.
4. **Structure** (optional): `intro swells`, `drops at :15`, `outro fades`.

**Example:**
```
lo-fi piano, rainy evening, 80bpm, melancholy. intro swells, soft drum enters at :10, outro fades.
```

For reel backing tracks, target 30s (`--duration 30` where supported).

### SFX — short and literal

SFX prompts should be concrete and named:

- `glass shatter, close mic, high frequency`
- `whoosh, fast sweep, low-to-high pitch`
- `UI confirm ding, short, high quality, clean`
- `heavy mechanical thunk, bass, reverb`

Under 1 second unless you explicitly want a longer ambience.

## Common recipes

### Single voiceover line

```bash
gen-ai generate -m eleven-v3 \
  -p "warm, calm, 30s female, confident, measured pace. \"Welcome to Picsart. Generate anything, from your terminal.\"" \
  --json --no-input | jq -r '.url' | xargs curl -L -o vo.mp3
```

### Voiceover with a specific voice

```bash
gen-ai generate -m eleven-v3 --voice 21m00Tcm4TlvDq8ikWAM \
  -p "\"Welcome. Let's build.\"" \
  --json --no-input | jq -r '.url' | xargs curl -L -o vo.mp3

# See available voices:
gen-ai models info eleven-v3
```

### Multilingual VO (5 markets, one batch)

```bash
cat > voice.json <<EOF
{
  "defaults": { "model": "eleven-multilingual-v2" },
  "jobs": [
    { "id": "en", "prompt": "Welcome to the show." },
    { "id": "de", "prompt": "Willkommen zur Show." },
    { "id": "ja", "prompt": "ようこそ、ショーへ。" },
    { "id": "pt", "prompt": "Bem-vindo ao show." },
    { "id": "es", "prompt": "Bienvenido al show." }
  ]
}
EOF
gen-ai batch run voice.json -o ./voice
```

### Voice cloning / dubbing (STS)

Preserve a voice identity; change the words:

```bash
gen-ai generate -m eleven-sts-v2 \
  --audio source-take.mp3 \
  -p "\"This is the new line that should sound exactly like the source voice.\"" \
  --json --no-input | jq -r '.url' | xargs curl -L -o new-line.mp3
```

For localized dubbing with voice consistency:

```bash
gen-ai generate -m eleven-multilingual-sts-v2 \
  --audio source-en.mp3 --locale de \
  -p "\"Neue Zeile auf Deutsch.\"" \
  --json --no-input | jq -r '.url' | xargs curl -L -o new-line-de.mp3
```

### Backing music for a 30s reel

```bash
gen-ai generate -m minimax-music \
  -p "upbeat confident synth, 120bpm, uplifting. intro drums, melody enters at :08, outro fades." \
  --duration 30 --json --no-input | jq -r '.url' | xargs curl -L -o music.mp3
```

### SFX set for a UI

```bash
cat > ui-sfx.json <<EOF
{
  "defaults": { "model": "elevenlabs-sfx" },
  "jobs": [
    { "id": "confirm", "prompt": "soft UI confirm ding, short, high quality" },
    { "id": "error", "prompt": "subtle UI error buzz, short, low frequency" },
    { "id": "success", "prompt": "bright UI success chime, short, cheerful" },
    { "id": "hover", "prompt": "very subtle UI hover tick, tiny" }
  ]
}
EOF
gen-ai batch run ui-sfx.json -o ./sfx
```

### Auto-matched audio for a video

```bash
gen-ai generate -m kling-v2a --video reel.mp4 --json --no-input \
  | jq -r '.url' | xargs curl -L -o reel-with-sound.mp4
```

### Podcast intro — voice + music stems

```bash
# 1. VO line
gen-ai generate -m eleven-v3 \
  -p "warm, confident, energetic. \"This week on the show…\"" \
  --json --no-input | jq -r '.url' | xargs curl -L -o intro-vo.mp3

# 2. Backing music
gen-ai generate -m minimax-music \
  -p "cinematic opener, 110bpm, rising, 8s" --duration 8 \
  --json --no-input | jq -r '.url' | xargs curl -L -o intro-music.mp3

# 3. Deliver intro-vo.mp3 + intro-music.mp3 as stems, or mix in any DAW/editor.
# Optional preview mix if you already have ffmpeg:
ffmpeg -i intro-music.mp3 -i intro-vo.mp3 \
  -filter_complex "[1:a]volume=1.0[a1];[0:a]volume=0.35[a0];[a0][a1]amix=inputs=2:duration=longest" \
  -c:a libmp3lame intro.mp3
```

## MCP / natural-language patterns

When the CLI isn't installed, the MCP server gives the agent the same capabilities:

- *"Voice this line in a warm, confident read with Eleven v3: 'Welcome to Picsart.' Save as vo.mp3."*
- *"Localize this ad read across DE, FR, JP, BR, ES using Eleven Multilingual v2 — one batch."*
- *"Dub this source take into German, preserving the same voice character. Use Eleven STS."*
- *"Generate a 30-second uplifting synth backing track at 120bpm. Use MiniMax Music."*
- *"Make me a set of 4 UI sounds: confirm, error, success, hover. Short, clean."*
- *"Add AI-matched foley to reel.mp4."*

The agent should:

1. Always include the **voice character** line for TTS — without it, reads sound robotic.
2. Batch multilingual requests rather than firing N serial calls.
3. Prefer `eleven-v3` as the default TTS unless the user names another voice.
4. Call `gen-ai_pricing` on large batches (50+ lines) — character counts add up.

## Voice catalog

ElevenLabs models accept `--voice <id>`:

```bash
gen-ai models info eleven-v3                # list available voices
gen-ai config set defaultModel eleven-v3    # set the default model if desired
```

**Popular voice archetypes** (IDs rotate; always verify with `models info`):

- Warm, mid-30s female, US English — default ad-read voice
- Deep, mid-40s male, US English — authoritative narration
- Bright, 20s female, US English — explainer / onboarding
- Neutral, 30s, RP British English — editorial / product launch
- Japanese / Spanish / German native speakers — see `models info eleven-multilingual-v2`

## Cost control

Audio is cheap, but character counts add up on campaigns:

- **Eleven v3 / Multilingual v2**: ~1 credit per 250 characters
- **Eleven STS**: ~2 credits per 250 characters (costlier — voice-preserving)
- **ElevenLabs SFX**: ~1 credit per SFX
- **MiniMax Music**: ~5 credits per 30 seconds
- **Kling T2A / V2A**: varies — check pricing first

Check pricing and validate manifests before large batches:

```bash
gen-ai pricing eleven-multilingual-v2
gen-ai pricing minimax-music
gen-ai batch run voice.json --dry-run
```

## Output hygiene

- **Format**: `.mp3` for web delivery; `.wav` when downstream editing needs lossless; `.m4a` for iOS-first.
- **Loudness**: generated assets are usable as-is; normalize in a DAW/editor when needed. Optional local polish if ffmpeg is already available: `ffmpeg -i in.mp3 -af loudnorm=I=-16:LRA=11:TP=-1.5 out.mp3`.
- **Silence trim**: trim in a DAW/editor when needed. Optional local trim if ffmpeg is already available: `ffmpeg -af silenceremove=1:0:-50dB`.
- **Stereo vs mono**: VO is usually mono; music stereo. TTS models emit mono by default.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Robotic / flat read | Add the voice-character line and delivery note at the start of the prompt |
| Wrong emphasis | Add explicit punctuation — commas = micro-pauses, periods = full stops, ellipses = long pause |
| Pronunciation off | Spell the word phonetically in the prompt, e.g., "Pics-Art" instead of "Picsart" |
| Voice drifts across lines | Use `eleven-multilingual-v2` (consistent-voice mode) or STS for the whole batch |
| Music too "AI-sounding" | Add structure cues ("intro swells at :05") and a concrete genre, not just a mood |
| SFX is too long | Add "short" and "tight" to the prompt; trim in post if needed |
| V2A audio mismatches video | Use `kling-v2a` with a clean `--video` source — compressed / low-res video degrades matching |
| Multilingual voice sounds off | Use the multilingual variant (`eleven-multilingual-v2`), not the base `eleven-v3` |

## For agents

- **Default TTS**: `eleven-v3` unless the user specifies another voice.
- **For ads and marketing**, always include the voice-character line — without it, reads sound robotic.
- **For multilingual**, prefer one batch over N serial calls — saves latency and keeps voice identity consistent.
- **For STS (dubbing)**, require the source audio via `--audio` — STS cannot generate a voice from scratch.
- **If the CLI isn't installed and MCP is available**, call MCP tools directly.
- **Never assume a voice ID** — look it up via `gen-ai models info eleven-v3` or the `gen-ai_model_info` MCP tool before committing.

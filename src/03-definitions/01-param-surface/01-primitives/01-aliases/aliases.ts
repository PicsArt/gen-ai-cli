/**
 * Block 1 — Aliases.
 *
 * Closed static table of historic flag-name overrides. Read once by Block 3
 * (Catalog) when deriving kebab-case CLI flag names from SDK descriptor keys.
 *
 * The default derivation is deterministic camelCase → kebab-case (handled by
 * Block 2 — Coercion's `camelToKebab`). This table overrides that default
 * for a small set of ergonomic exceptions and historic names.
 *
 * Add an entry only when:
 *   1. The flag is invoked in nearly every generation call and deserves a
 *      single-character short alias (`-p`, `-m`, `-i`, `-d`, `-n`, `-r`).
 *   2. The historic CLI shipped under a different name and renaming would
 *      break existing user scripts (`--voice` for `voiceId`, `--image` for
 *      `imageUrls`, `--video` for `videoUrl`, `--audio` for `audioUrl`).
 *   3. The full kebab name is awkward and a shorter long alias is documented
 *      in `CLI_FLOWS.md` (`--ar` for `--aspect-ratio`).
 *
 * Every entry MUST eventually map to a real SDK descriptor key. The
 * Catalog snapshot test (Block 3) asserts this — orphan aliases fail CI.
 *
 * Internal consistency (no collisions, well-formed names) is verified
 * by `aliases.test.ts`.
 */

export interface FlagAlias {
  /** Override the kebab-case name derived from the SDK key. */
  flag?: string;
  /** Single-character short alias (e.g. 'p' for --prompt). */
  char?: string;
  /** Additional long-form aliases (e.g. ['ar'] for --aspect-ratio). */
  aliases?: readonly string[];
}

export type AliasMap = Readonly<Record<string, FlagAlias>>;

export const ALIAS_MAP: AliasMap = {
  // ── Short single-character aliases for the most-used flags ────────────
  // Reserved by oclif/POSIX: -h (help), -v / -V (version).
  // Reserved by universal flags: -o (output), -q (quiet), -s (silent).
  prompt: { char: 'p' },
  count: { char: 'n' },
  duration: { char: 'd' },
  resolution: { char: 'r' },

  // ── Historic flag-name overrides (preserve existing user scripts) ─────
  // SDK key `model` (Topaz enhance engine, Flux 3 Video quality tier) must
  // not shadow the CLI's built-in --model / -m model selector, so the
  // parameter ships as --model-version instead.
  model: { flag: 'model-version' },
  // SDK key uses Urls plural; CLI ships --image (also -i, repeatable).
  imageUrls: { flag: 'image', char: 'i' },
  // SDK key uses Url singular; CLI ships --video / --audio.
  // --vd is a typing-shortcut alongside --video.
  videoUrl: { flag: 'video', aliases: ['vd'] },
  // --audio is common in avatar / dub / voice-clone flows; -a is the
  // obvious mnemonic and free in our namespace.
  audioUrl: { flag: 'audio', char: 'a' },
  // SDK key is voiceId; CLI ships --voice (shorter, more familiar).
  // --ve is a typing-shortcut alongside --voice.
  voiceId: { flag: 'voice', aliases: ['ve'] },

  // ── Long-form ergonomic aliases ───────────────────────────────────────
  // Each adds a shorter alternative to the verbose kebab default.
  // None shadow a subcommand or existing flag/alias.

  // --aspect-ratio also responds to --ar (very common in video commands).
  aspectRatio: { aliases: ['ar'] },

  // --negative-prompt is long; --neg-prompt and --neg are friendlier.
  negativePrompt: { aliases: ['neg-prompt', 'neg'] },
  // --generate-audio is awkward; --audio-gen reads more naturally.
  generateAudio: { aliases: ['audio-gen'] },
  // --cfg-scale is the API name; --cfg is the colloquial short.
  cfgScale: { aliases: ['cfg'] },
  // --image-weight → --weight (only weight param in the surface).
  imageWeight: { aliases: ['weight'] },
  // --rendering-speed → --speed (Ideogram + Kling models).
  renderingSpeed: { aliases: ['speed'] },
  // (The old `referenceImages` / `referenceVideos` / `referenceAudios`
  // aliases were dropped when the SDK consolidated those descriptors into
  // `imageUrls` / `videoUrls` / `audioUrls`. Pass references via `-i`,
  // `--video-urls`, or `--audio-urls`.)
  // --thinking-level → --thinking (Gemini 3.x reasoning depth).
  thinkingLevel: { aliases: ['thinking'] },
  // --human-fidelity → --fidelity (Kling face-fidelity slider).
  humanFidelity: { aliases: ['fidelity'] },
  // --character-orientation → --orientation (Kling motion-control).
  characterOrientation: { aliases: ['orientation'] },
  // --keep-original-sound → --keep-audio (Kling omni-video, motion-ctrl).
  keepOriginalSound: { aliases: ['keep-audio'] },
  // --external-task-id → --task-id (Kling tracking).
  externalTaskId: { aliases: ['task-id'] },
  // --source-image-id → --source-id (Recraft Explore Similar).
  sourceImageId: { aliases: ['source-id'] },
  // --output-format → --format (OpenAI gpt-image; well-known abbreviation).
  outputFormat: { aliases: ['format'] },
  // --sound-effect-prompt → --sfx-prompt (Kling V2A).
  soundEffectPrompt: { aliases: ['sfx-prompt'] },
  // --bgm-prompt → --bgm (Kling V2A background-music prompt).
  bgmPrompt: { aliases: ['bgm'] },
  // --asmr-mode → --asmr (Kling V2A toggle).
  asmrMode: { aliases: ['asmr'] },
  // Historic CLI shipped --remove-bg-noise; preserve that name + shorten
  // from the 23-char default --remove-background-noise.
  removeBackgroundNoise: { flag: 'remove-bg-noise' },
};

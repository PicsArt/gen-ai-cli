/**
 * Reconstruct `gen-ai generate` CLI args from a stored history entry.
 *
 * Shared by `redo` (re-run the last entry) and `replay` (re-run an entry by id).
 * Explicit overrides win over the stored values; otherwise the entry's model,
 * prompt, params, and media inputs are replayed as-is.
 */
import type { HistoryEntry } from '#services/history.ts';

export interface ReplayOverrides {
  model?: string;
  prompt?: string;
  duration?: number;
  'aspect-ratio'?: string;
  resolution?: string;
  count?: number;
  silent?: boolean;
  download?: string;
}

/** Map of `HistoryEntry.params` keys → generate flags. */
const PARAM_FLAGS: Record<string, string> = {
  aspectRatio: '--aspect-ratio',
  duration: '--duration',
  resolution: '--resolution',
  count: '--count',
  quality: '--quality',
  style: '--style',
  negativePrompt: '--negative-prompt',
  cfgScale: '--cfg-scale',
  imageWeight: '--image-weight',
};

export function reconstructGenerateArgs(entry: HistoryEntry, overrides: ReplayOverrides = {}): string[] {
  const args: string[] = [];

  args.push('--model', overrides.model ?? entry.model);

  if (overrides.prompt) {
    args.push('--prompt', overrides.prompt);
  } else if (entry.prompt) {
    args.push('--prompt', entry.prompt);
  }

  // Each param: explicit override wins, else fall back to the stored value.
  // oclif stores flags under their hyphenated keys (e.g. 'aspect-ratio').
  for (const [paramKey, flag] of Object.entries(PARAM_FLAGS)) {
    const flagKey = flag.replace(/^--/, '');
    const explicit = (overrides as Record<string, unknown>)[flagKey];
    if (explicit != null) {
      args.push(flag, String(explicit));
    } else if (entry.params[paramKey] != null) {
      args.push(flag, String(entry.params[paramKey]));
    }
  }

  if (entry.params.generateAudio === true) args.push('--generate-audio');
  if (entry.params.enhancePrompt === true) args.push('--enhance-prompt');

  for (const url of entry.imageUrls ?? []) args.push('--image', url);
  if (entry.videoUrl) args.push('--video', entry.videoUrl);
  if (entry.audioUrl) args.push('--audio', entry.audioUrl);
  // Array media slots (multiple:true flags — one occurrence per URL) and the
  // frame/Kling single-file slots. Without these, replaying e.g. a
  // seedance-2.0-video-extend run silently dropped its reference videos.
  for (const url of entry.videoUrls ?? []) args.push('--video-urls', url);
  for (const url of entry.audioUrls ?? []) args.push('--audio-urls', url);
  if (entry.startFrame) args.push('--start-frame', entry.startFrame);
  if (entry.endFrame) args.push('--end-frame', entry.endFrame);
  if (entry.staticMask) args.push('--static-mask', entry.staticMask);
  if (entry.sceneImage) args.push('--scene-image', entry.sceneImage);
  if (entry.styleImage) args.push('--style-image', entry.styleImage);

  if (overrides.silent) args.push('--silent');
  if (overrides.download) args.push('--download', overrides.download);

  return args;
}

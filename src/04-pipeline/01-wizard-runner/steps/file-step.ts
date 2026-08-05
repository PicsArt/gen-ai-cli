/**
 * Wizard step: file input collection.
 *
 * Pre-fills from --image/--video/--audio flags, pre-fetches Drive media,
 * then delegates to promptForInputFiles() for any missing file inputs.
 */
import type { GenerationContext, ModelDefinition } from '@picsart/ai-sdk';
import { prefetchDriveMedia, promptForInputFiles } from '#pipeline/01-wizard-runner/prompts/prompt-params.ts';
import type { CliDeps } from '#root/deps.ts';
import type { ResolvedInputs } from '#root/types.ts';

export interface FileStepFlags {
  image?: string | string[];
  'start-frame'?: string;
  'end-frame'?: string;
  video?: string;
  audio?: string;
  'video-urls'?: string[];
  'audio-urls'?: string[];
  'static-mask'?: string;
  'scene-image'?: string;
  'style-image'?: string;
  prompt?: string;
}

type FileStepCtx = Partial<GenerationContext> & {
  staticMask?: string;
  sceneImage?: string;
  styleImage?: string;
};

export async function runFileStep(
  _deps: CliDeps,
  model: ModelDefinition,
  flags: FileStepFlags,
): Promise<ResolvedInputs['files']> {
  const promptProvided = typeof flags.prompt === 'string' && flags.prompt.trim().length > 0;
  // Build initial context from CLI flags
  const ctx: FileStepCtx = {};

  if (flags.image) {
    ctx.imageUrls = Array.isArray(flags.image) ? flags.image : [flags.image];
  }
  if (flags['start-frame']) {
    ctx.startFrame = flags['start-frame'];
  }
  if (flags['end-frame']) {
    ctx.endFrame = flags['end-frame'];
  }
  if (flags.video) {
    ctx.videoUrl = flags.video;
  }
  if (flags.audio) {
    ctx.audioUrl = flags.audio;
  }
  if (flags['video-urls']?.length) {
    ctx.videoUrls = flags['video-urls'];
  }
  if (flags['audio-urls']?.length) {
    ctx.audioUrls = flags['audio-urls'];
  }
  if (flags['static-mask']) {
    ctx.staticMask = flags['static-mask'];
  }
  if (flags['scene-image']) {
    ctx.sceneImage = flags['scene-image'];
  }
  if (flags['style-image']) {
    ctx.styleImage = flags['style-image'];
  }

  // Pre-fetch Drive media for the model
  const drive = await prefetchDriveMedia(model);

  // Prompt for any missing file inputs
  const updates = await promptForInputFiles(model, ctx, drive, { promptProvided });

  // Merge flag-based and prompted values
  const merged: FileStepCtx = { ...ctx, ...updates };

  return {
    images: merged.imageUrls,
    startFrame: merged.startFrame,
    endFrame: merged.endFrame,
    video: merged.videoUrl,
    audio: merged.audioUrl,
    videos: merged.videoUrls,
    audios: merged.audioUrls,
    staticMask: merged.staticMask,
    sceneImage: merged.sceneImage,
    styleImage: merged.styleImage,
  };
}

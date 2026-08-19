/**
 * Dry-run validation — builds and validates payload without executing.
 * No UI imports. Returns validation result.
 */
import { Models } from '@picsart/ai-sdk';
import type { ResolvedInputs } from '#root/types.ts';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  schema?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/**
 * Validate inputs against a model's schema without executing.
 * Used for --dry-run flag.
 */
export function validateDryRun(inputs: ResolvedInputs): ValidationResult {
  const ctx: Record<string, unknown> = {
    prompt: '',
    ...inputs.params,
  };

  if (inputs.files.images?.length) ctx.imageUrls = inputs.files.images;
  if (inputs.files.startFrame) ctx.startFrame = inputs.files.startFrame;
  if (inputs.files.endFrame) ctx.endFrame = inputs.files.endFrame;
  if (inputs.files.video) ctx.videoUrl = inputs.files.video;
  if (inputs.files.audio) ctx.audioUrl = inputs.files.audio;
  if (inputs.files.videos?.length) ctx.videoUrls = inputs.files.videos;
  if (inputs.files.audios?.length) ctx.audioUrls = inputs.files.audios;
  if (inputs.files.staticMask) ctx.staticMask = inputs.files.staticMask;
  if (inputs.files.sceneImage) ctx.sceneImage = inputs.files.sceneImage;
  if (inputs.files.styleImage) ctx.styleImage = inputs.files.styleImage;
  if (inputs.files.styleReferences?.length) ctx.styleReferenceUrls = inputs.files.styleReferences;

  const result = Models.validate(inputs.model.id, ctx);
  const schema = Models.toSchema(inputs.model.id);

  return {
    valid: result.valid,
    errors: result.errors,
    schema,
    context: ctx,
  };
}

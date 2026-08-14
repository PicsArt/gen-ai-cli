/**
 * Scripted resolver — reads inputs from CLI flags, validates, fails fast.
 * No interactive prompts. Every missing input is a clear error.
 */
import { findModel, Models } from '@picsart/ai-sdk';
import type { FlowSpec } from '#flows';
import { UsageError } from '#infra/errors/usage.ts';
import { ValidationError } from '#infra/errors/validation.ts';
import type { CliDeps } from '#root/deps.ts';
import type { ResolvedInputs } from '#root/types.ts';
import {
  buildParamsFromFlags,
  configDefaultModelId,
  deriveTopLevelPromptFromMulti,
  validateMultiShot,
  validateRequiredInputs,
} from '../types.ts';

/**
 * Resolve all inputs from CLI flags. No prompts.
 * Throws UsageError or ValidationError with clear messages on failure.
 */
export async function resolveScripted(
  flow: FlowSpec,
  flags: Record<string, unknown>,
  deps: CliDeps,
): Promise<ResolvedInputs> {
  // 1. Resolve model. Precedence: explicit --model > user-config
  // `defaultModel` (only when it passes this flow's filter — a global
  // preference must not break unrelated commands) > flow.defaultModel.
  const modelFlag =
    (flags.model as string | undefined) ?? configDefaultModelId(flow, deps.config?.defaultModel) ?? flow.defaultModel;
  if (!modelFlag) {
    throw new UsageError('Model is required. Use --model (-m) to specify a model.');
  }

  const model = findModel(modelFlag);
  if (!model) {
    throw new UsageError(`Model not found: "${modelFlag}". Run "gen-ai models" to see available models.`);
  }

  if (!flow.modelFilter(model)) {
    throw new UsageError(`Model "${model.name}" is not supported by the ${flow.id} flow.`);
  }

  // 2. Collect files from flags. Empty strings (typical when a user passes
  // -i "$VAR" and $VAR is unset) fail fast — otherwise an empty URL gets
  // sent to the SDK and the API rejects with a cryptic 400.
  const files: ResolvedInputs['files'] = {};
  const rejectEmpty = (flagLabel: string, val: string) => {
    if (val.trim().length === 0) {
      throw new UsageError(`${flagLabel} is empty — check your shell variable expanded correctly.`);
    }
  };
  const cleanArray = (label: string, arr: string[] | undefined): string[] | undefined => {
    if (!arr || arr.length === 0) return undefined;
    for (const v of arr) rejectEmpty(label, v);
    return arr;
  };

  // `-i` ergonomics: some i2v models (wan-2.7-i2v, luma-ray-flash-2, etc.)
  // expose `startFrame` instead of `imageUrls`. When the model has only
  // `startFrame` and the user passed `-i`, route the first image into
  // `start-frame` so a single CLI surface covers both shapes.
  const imgArr = cleanArray('--image (-i)', flags.image as string[] | undefined);
  const modelHasImageUrls = !!Models.getFileParam(model.id, 'imageUrls');
  const modelHasStartFrame = !!Models.getFileParam(model.id, 'startFrame');
  if (imgArr && !modelHasImageUrls && modelHasStartFrame && !flags['start-frame']) {
    files.startFrame = imgArr[0];
  } else if (imgArr) {
    files.images = imgArr;
  }
  if (flags['start-frame']) {
    const v = flags['start-frame'] as string;
    rejectEmpty('--start-frame', v);
    files.startFrame = v;
  }
  if (flags['end-frame']) {
    const v = flags['end-frame'] as string;
    rejectEmpty('--end-frame', v);
    files.endFrame = v;
  }
  // `--video` / `--audio` get the same bridge as `-i` → startFrame: models
  // like seedance-2.0-video-extend expose the ARRAY slot (`videoUrls`) and
  // no `videoUrl`; seed-audio models likewise expose only `audioUrls`.
  // Route the single-file flag into the array slot for those models so one
  // CLI surface covers both shapes — otherwise the value lands on a ctx key
  // the model doesn't declare and the API rejects with a cryptic 400.
  if (flags.video) {
    const v = flags.video as string;
    rejectEmpty('--video', v);
    const onlyVideoUrls = !Models.getFileParam(model.id, 'videoUrl') && !!Models.getFileParam(model.id, 'videoUrls');
    if (onlyVideoUrls && !flags['video-urls']) {
      files.videos = [v];
    } else {
      files.video = v;
    }
  }
  if (flags.audio) {
    const v = flags.audio as string;
    rejectEmpty('--audio', v);
    const onlyAudioUrls = !Models.getFileParam(model.id, 'audioUrl') && !!Models.getFileParam(model.id, 'audioUrls');
    if (onlyAudioUrls && !flags['audio-urls']) {
      files.audios = [v];
    } else {
      files.audio = v;
    }
  }
  // Reference-image inputs ride on the consolidated `imageUrls` descriptor
  // (auto-derived to `-i`/`--image`) and are already handled above via
  // `flags.image`.
  //
  // Reference-video / -audio inputs use the consolidated `videoUrls` /
  // `audioUrls` descriptors. Param Surface auto-derives the FLAG
  // declarations (`--video-urls`, `--audio-urls`) but the flag-reader
  // skips `file` kinds (its contract — `file` descriptors are owned by
  // the resolver's file pipeline). So we have to bridge them here, just
  // like we do for `--image` / `--video` / `--audio`. Without this,
  // models that need `videoUrls` (e.g. `seedance-2.0-video-extend`) fail
  // with a cryptic SDK 400 because the flag value never reaches the
  // generation context.
  const videoUrls = cleanArray('--video-urls', flags['video-urls'] as string[] | undefined);
  if (videoUrls) files.videos = videoUrls;
  const audioUrls = cleanArray('--audio-urls', flags['audio-urls'] as string[] | undefined);
  if (audioUrls) files.audios = audioUrls;
  // Kling-specific single-file slots (V3 motion brush + multi-image scene/style refs).
  // Same shape as `--start-frame` / `--end-frame` — one string per flag.
  if (flags['static-mask']) {
    const value = flags['static-mask'] as string;
    rejectEmpty('--static-mask', value);
    files.staticMask = value;
  }
  if (flags['scene-image']) {
    const value = flags['scene-image'] as string;
    rejectEmpty('--scene-image', value);
    files.sceneImage = value;
  }
  if (flags['style-image']) {
    const value = flags['style-image'] as string;
    rejectEmpty('--style-image', value);
    files.styleImage = value;
  }

  // 3. Build params from flags (prompt lives INSIDE params per ResolvedInputs
  // spec). The model id makes coercion use the model's OWN descriptors rather
  // than the cross-model merge — see collectGenerationContext.
  const params = buildParamsFromFlags(flags, model.id);
  if (typeof flags.prompt === 'string') params.prompt = flags.prompt;

  // When the user populated a richer prompt source (Kling V3 multiPrompt
  // and friends) but didn't pass an explicit --prompt, derive the top-level
  // prompt from the first item so validation sees it as satisfied.
  const derived = deriveTopLevelPromptFromMulti(params);
  if (derived !== undefined) params.prompt = derived;

  // 4. Validate required inputs (prompt is read from params)
  const errors = validateRequiredInputs(flow, { model, params, files });
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  // 5. Vendor-specific cross-field invariants the API enforces at submit.
  // We catch them here so the failure is a clear local error, not a 400.
  validateMultiShot(params);

  return { model, params, files };
}

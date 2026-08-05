/**
 * Resolver-specific types and validation helpers.
 *
 * These types extend the shared types from types.ts with resolver-internal
 * concerns like validation errors, flag mapping, and model filtering.
 */

import type { ModelDefinition } from '@picsart/ai-sdk';
import { findModel, Models } from '@picsart/ai-sdk';
import type { FlowSpec } from '#flows';
import { UsageError } from '#infra/errors/usage.ts';
import type { FieldError } from '#infra/errors/validation.ts';
import { collectGenerationContext, getCatalog } from '#param-surface';
import type { ResolvedInputs } from '#root/types.ts';

/**
 * SDK gap overlay — flags whose ctx key has no `paramConfig` descriptor in
 * the SDK today, so they never appear in the Catalog. Each row is staged
 * for deletion the moment the SDK adds the descriptor.
 *
 * Tracked as open gaps against `@picsart/ai-sdk` in the `pa-gen-ai-sdk` repo.
 */
const SDK_GAP_FLAGS: Readonly<Record<string, string>> = {
  // Kling video: read by buildPayload, no paramConfig
  'external-task-id': 'externalTaskId',
  // Kling V2A: still drives audio routing, no descriptor yet
  'sound-effect-prompt': 'soundEffectPrompt',
  'bgm-prompt': 'bgmPrompt',
  'asmr-mode': 'asmrMode',
};

/**
 * Resolve a model from a flag value (ID or name).
 * Returns undefined if not found or doesn't match the operation filter.
 */
export function resolveModelFromFlag(modelFlag: string | undefined, flow: FlowSpec): ModelDefinition | undefined {
  if (!modelFlag) return undefined;
  const model = findModel(modelFlag);
  if (!model) return undefined;
  if (!flow.modelFilter(model)) return undefined;
  return model;
}

/** Get all models that match a flow's filter (and aren't disabled). */
export function getModelsForOperation(flow: FlowSpec): ModelDefinition[] {
  return Models.list().filter((m) => !m.disabled && flow.modelFilter(m));
}

/**
 * Validate that all required inputs are present.
 * Returns an array of field errors (empty if valid).
 */
export function validateRequiredInputs(flow: FlowSpec, inputs: Partial<ResolvedInputs>): FieldError[] {
  const errors: FieldError[] = [];
  for (const input of flow.requiredInputs) {
    switch (input) {
      case 'prompt': {
        const prompt = inputs.params?.prompt as string | undefined;
        if (!prompt?.trim()) {
          errors.push({ field: '--prompt (-p)', message: 'Prompt is required' });
        }
        break;
      }
      case 'image':
        // `startFrame` counts as image input — some i2v models (wan-2.7-i2v,
        // luma-ray-flash-2) expose `startFrame` instead of `imageUrls`.
        if (!inputs.files?.images?.length && !inputs.files?.startFrame) {
          errors.push({ field: '--image (-i) or --start-frame', message: 'Image input is required' });
        }
        break;
      case 'video':
        if (!inputs.files?.video) {
          errors.push({ field: '--video', message: 'Video input is required' });
        }
        break;
      case 'audio':
        if (!inputs.files?.audio) {
          errors.push({ field: '--audio', message: 'Audio input is required' });
        }
        break;
    }
  }
  return errors;
}

/**
 * Enforce each model's declared per-slot file caps. The SDK file descriptor
 * exposes an array `max` (via `Models.getFileParam`); exceeding it would
 * otherwise surface as a cryptic backend 400. Throws a clear `UsageError`
 * naming the slot, the cap, and what the user passed.
 *
 * Only the array slots (images / videos / audios) need checking — single-file
 * slots can only ever hold one value from their flag.
 */
export function validateFileSlotLimits(model: ModelDefinition, files: ResolvedInputs['files']): void {
  const arraySlots = [
    { slot: 'images', ctxKey: 'imageUrls', noun: 'image', flag: '--image (-i)' },
    { slot: 'videos', ctxKey: 'videoUrls', noun: 'video', flag: '--video-urls' },
    { slot: 'audios', ctxKey: 'audioUrls', noun: 'audio', flag: '--audio-urls' },
  ] as const;

  for (const { slot, ctxKey, noun, flag } of arraySlots) {
    const values = files[slot];
    if (!values || values.length === 0) continue;
    const param = Models.getFileParam(model.id, ctxKey);
    if (param && param.max > 0 && values.length > param.max) {
      const plural = param.max === 1 ? '' : 's';
      throw new UsageError(
        `${model.name} accepts at most ${param.max} ${noun}${plural} for ${flag}; you provided ${values.length}.`,
      );
    }
  }
}

/**
 * Build params from flags by walking the Param Surface catalog.
 *
 * The catalog is the single source of truth: every SDK `paramConfig`
 * descriptor surfaces here automatically — no hand-maintained flag→key
 * table. Object descriptors expand to per-subfield flags (`--shot-prompt`,
 * `--shot-duration`, …) which the reader reassembles into the SDK-shaped
 * array.
 *
 * One overlay: `SDK_GAP_FLAGS` covers a handful of fields the SDK reads
 * in `buildPayload` but does not yet declare as descriptors. Each entry
 * deletes itself the moment the SDK closes the gap.
 *
 * Unknown flags (anything outside the catalog AND outside the gap list)
 * are silently ignored — universal flags like `--json`, `--quiet` live
 * here and must not leak into the SDK `GenerationContext`.
 */
export function buildParamsFromFlags(flags: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = { ...collectGenerationContext(flags, getCatalog()) };

  for (const [flag, ctxKey] of Object.entries(SDK_GAP_FLAGS)) {
    if (flags[flag] != null) params[ctxKey] = flags[flag];
  }

  return params;
}

/**
 * Returns a top-level prompt derived from a richer prompt-source
 * descriptor (`multiPrompt` etc.) when the caller's params lack one.
 * Pure — does NOT mutate `params`. Caller assigns the result if
 * non-undefined.
 *
 * Returns undefined when:
 *   - `params.prompt` is already a non-empty string, OR
 *   - no recognized multi-source descriptor has a usable first entry.
 *
 * Lives here rather than in `resolve.ts` because both the dispatcher and
 * the scripted resolver call it, and `resolve.ts` already imports the
 * scripted resolver — homing it there made the two modules circular.
 */
export function deriveTopLevelPromptFromMulti(params: Record<string, unknown>): string | undefined {
  if (typeof params.prompt === 'string' && params.prompt.trim().length > 0) return undefined;
  const multi = params.multiPrompt;
  if (!Array.isArray(multi) || multi.length === 0) return undefined;
  const first = multi[0] as { prompt?: unknown };
  if (typeof first?.prompt === 'string' && first.prompt.trim().length > 0) {
    return first.prompt.trim();
  }
  return undefined;
}

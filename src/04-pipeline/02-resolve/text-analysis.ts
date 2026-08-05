/**
 * Text/LLM input finalization — applied to text models (`mode === 'text'`)
 * after the regular resolver produces `ResolvedInputs`. Used by both `ask`
 * (general LLM: prompt required, media optional) and `describe` (media
 * analysis: media required).
 *
 * Rules:
 *
 *   1. Video ⇒ video-capable model (ALL text flows) — only some text models
 *      declare a `videoUrl` param (today just `gemini-3-pro`). If a video was
 *      given to a model that can't take it: error when the user forced it with
 *      `-m`, otherwise auto-switch to a video-capable model in the same flow.
 *   2. Media-analysis flows only (`flow.requiresMedia`): default the prompt to
 *      a describe instruction when none was given, and require an image OR a
 *      video (the flat `requiredInputs` can't express "one of").
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { Models } from '@picsart/ai-sdk';
import type { FlowSpec } from '#flows';
import { UsageError } from '#infra/errors/usage.ts';
import type { ResolvedInputs } from '#root/types.ts';

const DEFAULT_ANALYSIS_PROMPT = 'Describe this image or video in detail.';

function modelAcceptsVideo(model: ModelDefinition): boolean {
  return Boolean(Models.getFileParam(model.id, 'videoUrl'));
}

/**
 * Returns a new `ResolvedInputs` with the text/LLM rules applied — does not
 * mutate its argument. `flags` is the parsed flag bag, used only to tell
 * whether the user explicitly chose a model (`-m`) vs. fell back to the flow
 * default.
 */
export function finalizeTextAnalysisInputs(
  inputs: ResolvedInputs,
  flags: Record<string, unknown>,
  flow: FlowSpec,
): ResolvedInputs {
  const hasImage = Boolean(inputs.files.images?.length);
  const hasVideo = Boolean(inputs.files.video);

  // Media-analysis flows (describe): default the prompt and require media.
  let params = inputs.params;
  if (flow.requiresMedia) {
    const prompt = inputs.params.prompt;
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      params = { ...inputs.params, prompt: DEFAULT_ANALYSIS_PROMPT };
    }
    if (!hasImage && !hasVideo) {
      throw new UsageError('Provide an image (-i) or a video (--video) to analyze.');
    }
  }

  // Video routing applies to any text flow: text-only and image inputs work on
  // every text model, but video needs a video-capable one.
  let model = inputs.model;
  if (hasVideo && !modelAcceptsVideo(model)) {
    const userPickedModel = typeof flags.model === 'string' && flags.model.length > 0;
    if (userPickedModel) {
      throw new UsageError(`Model "${model.name}" can't take video. Use a video-capable model such as gemini-3-pro.`);
    }
    const videoModel = Models.list().find((m) => flow.modelFilter(m) && modelAcceptsVideo(m));
    if (!videoModel) {
      throw new UsageError('No video-capable model is available for this flow.');
    }
    model = videoModel;
  }

  return { ...inputs, model, params };
}

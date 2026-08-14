/**
 * Interactive resolver orchestrator.
 *
 * Runs the 5 wizard steps in sequence:
 *   model → files → params → prompt (optional) → confirm
 *
 * Implements back/cancel navigation via step index tracking.
 * Back at the first step cancels the wizard (returns null).
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import type { FlowSpec } from '#flows';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import type { CliDeps } from '#root/deps.ts';
import type { ResolvedInputs } from '#root/types.ts';
import { runConfirmStep } from './steps/confirm-step.ts';
import type { FileStepFlags } from './steps/file-step.ts';
import { runFileStep } from './steps/file-step.ts';
import { runModelStep } from './steps/model-step.ts';
import { runParamsStep } from './steps/params-step.ts';
import { runPromptStep } from './steps/prompt-step.ts';

/** Whether this flow requires a text prompt. */
function needsPrompt(flow: FlowSpec, model: ModelDefinition): boolean {
  if (flow.requiredInputs.includes('prompt')) return true;
  // Text-to-* models always accept a prompt even if not strictly required
  return model.inputType.startsWith('t2');
}

/**
 * Derive a top-level prompt from a richer prompt-source descriptor (e.g.
 * Kling V3's `multiPrompt`) when the user filled it in but never typed a
 * separate global prompt. Returns undefined if no derivation is possible.
 *
 * Currently handles `multiPrompt` only; extend here when other vendors
 * publish similar list-of-shots / list-of-clips descriptors.
 */
function derivePromptFromParams(params: Record<string, unknown>): string | undefined {
  const multi = params.multiPrompt;
  if (Array.isArray(multi) && multi.length > 0) {
    const first = multi[0] as { prompt?: unknown };
    if (typeof first?.prompt === 'string' && first.prompt.trim().length > 0) {
      return first.prompt.trim();
    }
  }
  return undefined;
}

export async function resolveInteractive(
  flow: FlowSpec,
  flags: Record<string, unknown>,
  deps: CliDeps,
): Promise<ResolvedInputs | null> {
  // ── Step state ────────────────────────────────────────────────
  let model: ModelDefinition | undefined;
  let files: ResolvedInputs['files'] | undefined;
  let params: Record<string, unknown> | undefined;
  let prompt: string | undefined;

  // Steps:
  //   0 → model
  //   1 → files
  //   2 → params
  //   3 → prompt (may be skipped)
  //   4 → confirm
  const STEP_MODEL = 0;
  const STEP_FILES = 1;
  const STEP_PARAMS = 2;
  const STEP_PROMPT = 3;
  const STEP_CONFIRM = 4;
  const STEP_DONE = 5;

  let stepIndex = STEP_MODEL;

  while (stepIndex < STEP_DONE) {
    // ── Model ────────────────────────────────────────────────────
    if (stepIndex === STEP_MODEL) {
      const modelFlag = typeof flags.model === 'string' ? flags.model : undefined;
      const result = await runModelStep(deps, flow, modelFlag);

      if (result === BACK || result === CANCEL) {
        // Back/cancel at the first step = cancel wizard
        return null;
      }

      model = result as ModelDefinition;
      stepIndex = STEP_FILES;
      continue;
    }

    // ── Files ─────────────────────────────────────────────────────
    if (stepIndex === STEP_FILES) {
      const fileFlags: FileStepFlags = {
        image: flags.image as string | string[] | undefined,
        'start-frame': flags['start-frame'] as string | undefined,
        'end-frame': flags['end-frame'] as string | undefined,
        video: flags.video as string | undefined,
        audio: flags.audio as string | undefined,
        'video-urls': flags['video-urls'] as string[] | undefined,
        'audio-urls': flags['audio-urls'] as string[] | undefined,
        'static-mask': flags['static-mask'] as string | undefined,
        'scene-image': flags['scene-image'] as string | undefined,
        'style-image': flags['style-image'] as string | undefined,
        prompt: typeof flags.prompt === 'string' ? flags.prompt : undefined,
      };

      // runFileStep does not support back navigation — treat any error as cancel
      files = await runFileStep(deps, model!, fileFlags);
      stepIndex = STEP_PARAMS;
      continue;
    }

    // ── Params ────────────────────────────────────────────────────
    if (stepIndex === STEP_PARAMS) {
      // Pass previousParams when editing (params already set from a prior pass)
      const result = await runParamsStep(deps, model!, flags, params ?? undefined);

      if (result === CANCEL) return null;
      if (result === BACK) {
        // Go back to file step
        stepIndex = STEP_FILES;
        continue;
      }

      params = result as Record<string, unknown>;

      // If the user filled in a richer prompt source like `multiPrompt`
      // (Kling V3 multi-shot), seed the top-level prompt from the first
      // shot so the upcoming prompt-step skips the ask. The SDK still
      // wants a top-level `prompt` field alongside `multi_prompt[]`.
      if (prompt === undefined) {
        prompt = derivePromptFromParams(params);
      }

      stepIndex = STEP_PROMPT;
      continue;
    }

    // ── Prompt (optional) ─────────────────────────────────────────
    if (stepIndex === STEP_PROMPT) {
      if (!needsPrompt(flow, model!)) {
        // Skip this step entirely — keep existing prompt if already set
        stepIndex = STEP_CONFIRM;
        continue;
      }

      // If prompt was already provided (from flag or previous iteration), skip to confirm
      if (prompt?.trim()) {
        stepIndex = STEP_CONFIRM;
        continue;
      }

      const promptFlag = typeof flags.prompt === 'string' ? flags.prompt : undefined;
      const result = await runPromptStep(deps, model!, promptFlag);

      if (result === CANCEL) return null;
      if (result === BACK) {
        stepIndex = STEP_PARAMS;
        continue;
      }

      prompt = result as string;
      stepIndex = STEP_CONFIRM;
      continue;
    }

    // ── Confirm ───────────────────────────────────────────────────
    if (stepIndex === STEP_CONFIRM) {
      const result = await runConfirmStep(deps, model!, prompt, files!, params!);

      if (result === CANCEL) return null;

      if (result === 'edit-params') {
        stepIndex = STEP_PARAMS;
        continue;
      }

      if (result === 'edit-files') {
        files = undefined;
        stepIndex = STEP_FILES;
        continue;
      }

      // result === true → proceed
      stepIndex = STEP_DONE;
      continue;
    }

    // Unreachable — guard against infinite loops
    break;
  }

  const finalParams = { ...(params ?? {}) };
  if (typeof prompt === 'string' && prompt.trim()) finalParams.prompt = prompt;

  return {
    model: model!,
    params: finalParams,
    files: files ?? {},
  };
}

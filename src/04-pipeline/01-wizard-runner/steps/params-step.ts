/**
 * Wizard step: parameter collection.
 *
 * Pre-fills from CLI flags (kebab-case → camelCase), applies model defaults
 * for unset keys, then delegates to promptForParams().
 *
 * When `previousParams` is provided (edit mode), the wizard re-asks all params
 * with previous values as defaults so the user can change any of them.
 */

import type { GenerationContext, ModelDefinition } from '@picsart/ai-sdk';
import { Model } from '@picsart/ai-sdk';
import { promptForParams } from '#pipeline/01-wizard-runner/prompts/prompt-params.ts';
import type { StepResult } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { buildParamsFromFlags } from '#pipeline/02-resolve/types.ts';
import type { CliDeps } from '#root/deps.ts';

export async function runParamsStep(
  _deps: CliDeps,
  model: ModelDefinition,
  flags: Record<string, unknown>,
  previousParams?: Record<string, unknown>,
): Promise<StepResult<Record<string, unknown>>> {
  // Map kebab-case CLI flags to camelCase GenerationContext keys, coercing
  // against THIS model's own descriptors (not the cross-model merge).
  const fromFlags = buildParamsFromFlags(flags, model.id);

  // Apply model defaults for keys not set by flags
  const defaults: Record<string, unknown> = {};
  try {
    const modelDefaults = Model(model.id).params().getDefaults();
    for (const [key, val] of Object.entries(modelDefaults)) {
      if (fromFlags[key] == null) {
        defaults[key] = val;
      }
    }
  } catch {
    // Model lookup may fail for unknown ids — fail gracefully
  }

  // In edit mode: pass an empty context so promptForParams re-asks all
  // params, and hand it previousParams so every step's default is the
  // user's PREVIOUS choice — pressing Enter through the wizard keeps the
  // values instead of resetting to descriptor defaults.
  if (previousParams) {
    const editCtx: Partial<GenerationContext> = {} as Partial<GenerationContext>;
    const result = await promptForParams(model, editCtx, previousParams);

    if (result === BACK || result === CANCEL) return result;

    // Merge: start from previous, overlay wizard changes
    return { ...defaults, ...fromFlags, ...previousParams, ...(result as Record<string, unknown>) };
  }

  // Normal mode: skip params that already have values from flags
  const ctx: Partial<GenerationContext> = {
    ...defaults,
    ...fromFlags,
  } as Partial<GenerationContext>;

  const result = await promptForParams(model, ctx);

  if (result === BACK || result === CANCEL) return result;

  // Merge flags + defaults + wizard answers
  return { ...defaults, ...fromFlags, ...(result as Record<string, unknown>) };
}

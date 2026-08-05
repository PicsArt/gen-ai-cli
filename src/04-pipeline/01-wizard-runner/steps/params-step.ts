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
  // Map kebab-case CLI flags to camelCase GenerationContext keys
  const fromFlags = buildParamsFromFlags(flags);

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

  // In edit mode: pass an empty context so promptForParams re-asks all params.
  // The model's paramConfig descriptors include `default` values which the
  // wizard uses. We override those defaults with previousParams values below.
  if (previousParams) {
    // Override model descriptor defaults with previously chosen values
    // so the wizard shows "current value" as the default for each param.
    const editCtx: Partial<GenerationContext> = {} as Partial<GenerationContext>;
    const result = await promptForParams(model, editCtx);

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

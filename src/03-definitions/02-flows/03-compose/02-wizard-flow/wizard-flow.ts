/**
 * composeWizardForFlow — the per-flow wizard composer.
 *
 * The wizard-side twin of `01-flag-set/`. Reads a FlowSpec plus runtime
 * data and produces the final ordered `WizardStep[]` the wizard runner
 * walks.
 *
 * Pipeline:
 *   1. Apply `flow.modelFilter` to the model list → allowed-id set.
 *   2. Build the model-picker step from the matching models (its
 *      `choices` come from the runtime list, so it can't live in
 *      `static-steps` — see that sub-part's README for the reason).
 *   3. Narrow the universal catalog via `filterCatalog`.
 *   4. Generate descriptor-derived steps from the narrowed catalog
 *      (Param Surface's `wizard-schema`).
 *   5. Splice in the FlowSpec's `staticStepGroups`.
 *
 * Final order:
 *   [ model-picker, ...descriptor steps, ...static-group steps in spec order ]
 *
 * Key namespace: composer-owned steps use a `$`-prefixed key (`$model`)
 * so they can never collide with an SDK descriptor key — SDK keys are
 * camelCase identifiers, and a real `model` descriptor exists (the Topaz
 * enhance engine / Flux quality tier, shipped as --model-version).
 * `wizard-reader` only reads catalog keys, so `$`-keys pass through it
 * untouched; the runner owns their interpretation.
 *
 * Pure function. Caller injects all deps.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import type { Catalog } from '#param-surface';
import { generateWizardStepsFromCatalog, type WizardStep } from '#param-surface';
import { STATIC_STEP_GROUPS } from '../../01-static/02-static-steps/index.ts';
import { filterCatalog } from '../../01-static/03-catalog-filter/index.ts';
import type { FlowSpec } from '../../02-registry/01-flow-spec/index.ts';

export function composeWizardForFlow(
  flow: FlowSpec,
  catalog: Catalog,
  models: readonly ModelDefinition[],
): readonly WizardStep[] {
  const matching = models.filter((m) => flow.modelFilter(m));
  const allowedIds = new Set(matching.map((m) => m.id));

  const steps: WizardStep[] = [];

  // 1) Model picker first — the user must choose a model before the
  //    per-param steps make sense. Emitted whenever ≥1 model matches;
  //    with exactly one model its id is pre-filled as the default so a
  //    runner can skip or confirm it.
  const picker = buildModelPickerStep(matching, flow.defaultModel);
  if (picker !== undefined) steps.push(picker);

  // 2) Descriptor-derived steps from the narrowed catalog.
  const filtered = filterCatalog(catalog, allowedIds);
  steps.push(...generateWizardStepsFromCatalog(filtered));

  // 3) Static groups in spec order.
  for (const groupName of flow.staticStepGroups) {
    steps.push(...STATIC_STEP_GROUPS[groupName]);
  }

  return steps;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Model picker — lives here because its `choices` are runtime data     */
/* ─────────────────────────────────────────────────────────────────────── */

function buildModelPickerStep(
  matching: readonly ModelDefinition[],
  defaultModel: string | undefined,
): WizardStep | undefined {
  if (matching.length === 0) return undefined;

  const choices = matching.map((m) => ({ id: m.id, label: m.name ?? m.id }));
  const fallbackDefault = matching.length === 1 ? matching[0].id : undefined;
  const def = defaultModel ?? fallbackDefault;

  const step: WizardStep = {
    kind: 'select',
    key: '$model',
    label: 'Model',
    required: true,
    choices,
    ...(def !== undefined ? { default: def } : {}),
  };
  return step;
}

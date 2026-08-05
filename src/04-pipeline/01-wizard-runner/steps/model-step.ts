/**
 * Wizard step: model selection filtered by operation config.
 *
 * If --model flag was provided, validates it against the operation filter
 * and returns directly. Otherwise, shows an interactive fuzzy search
 * over the models matching config.modelFilter.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import chalk from 'chalk';
import type { FlowSpec } from '#flows';
import { renderPresetBadge } from '#infra/ui-core/components/badge.ts';
import { badgePriority } from '#infra/utils/badge-priority.ts';
import { fuzzyFilter } from '#infra/utils/fuzzy.ts';
import { PAGE_SIZE } from '#pipeline/01-wizard-runner/prompts/prompt-files.ts';
import type { NavResult } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { getModelsForOperation, resolveModelFromFlag } from '#pipeline/02-resolve/types.ts';
import type { CliDeps } from '#root/deps.ts';
import { searchWithNav } from '../nav.ts';

const INPUT_TYPE_LABELS: Record<string, string> = {
  t2i: 'text → image',
  i2i: 'image → image',
  t2v: 'text → video',
  i2v: 'image → video',
  v2v: 'video → video',
  t2a: 'text → audio',
  a2a: 'audio → audio',
};

function friendlyInputType(model: ModelDefinition): string {
  return INPUT_TYPE_LABELS[model.inputType] ?? model.inputType;
}

export async function runModelStep(
  deps: CliDeps,
  flow: FlowSpec,
  modelFlag?: string,
): Promise<NavResult<ModelDefinition>> {
  // If --model flag provided, validate and return directly
  if (modelFlag) {
    const model = resolveModelFromFlag(modelFlag, flow);
    if (model) return model;
    deps.out.warn(
      `Model "${modelFlag}" not found or doesn't support this operation — falling back to interactive search`,
    );
  }

  const models = getModelsForOperation(flow);
  models.sort((a, b) => badgePriority(a) - badgePriority(b));

  const selected = await searchWithNav<ModelDefinition>({
    message: `${chalk.hex('#E859B4')('🔍')} Search models`,
    pageSize: PAGE_SIZE,
    source: async (term) => {
      const query = term ?? '';
      const matched = query ? fuzzyFilter(models, query, (m) => `${m.name} ${m.id} ${m.provider}`) : models;

      return matched.map((m) => {
        const badges = m.badge?.length ? m.badge.map((b) => renderPresetBadge(b, { color: deps.color })).join(' ') : '';
        const line2 = chalk.dim(`  ${friendlyInputType(m)} · ${m.provider}`);
        return {
          name: `${chalk.bold(m.name)}${badges ? `  ${badges}` : ''}\n${line2}`,
          value: m,
        };
      });
    },
  });

  return selected as NavResult<ModelDefinition>;
}

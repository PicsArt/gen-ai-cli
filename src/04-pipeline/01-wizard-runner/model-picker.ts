/**
 * Interactive model selection flow — mode picker, fuzzy search,
 * and paginated model browsing.
 */

import type { GenerationMode, ModelDefinition } from '@picsart/ai-sdk';
import { Models } from '@picsart/ai-sdk';
import chalk from 'chalk';
import { getColor } from '#infra/ui-core/color.ts';
import { renderPresetBadge } from '#infra/ui-core/components/badge.ts';
import { badgePriority } from '#infra/utils/badge-priority.ts';
import { fuzzyFilter } from '#infra/utils/fuzzy.ts';
import type { WizardStep } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { BACK, CANCEL, runWizard } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { searchWithNav, selectWithNav } from './nav.ts';
import { PAGE_SIZE } from './prompts/prompt-files.ts';

export interface ModelSelection {
  model: ModelDefinition;
}

// Re-export for consumers that import from model-picker
export { detectMediaType } from '#infra/utils/media-types.ts';

/** Human-readable input type labels for the model picker. */
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
  const base = INPUT_TYPE_LABELS[model.inputType] ?? model.inputType;
  const output = model.mode === 'image' ? 'image' : model.mode === 'video' ? 'video' : 'audio';

  // Build a list of accepted inputs beyond the primary inputType
  const inputs: string[] = [];
  const primaryIsText = model.inputType.startsWith('t');
  const primaryIsImage = model.inputType.startsWith('i');
  const primaryIsVideo = model.inputType.startsWith('v');
  const primaryIsAudio = model.inputType.startsWith('a') || model.inputType === 'sts' || model.inputType === 'sfx';

  if (primaryIsText) inputs.push('text');
  if (primaryIsImage) inputs.push('image');
  if (primaryIsVideo) inputs.push('video');
  if (primaryIsAudio) inputs.push('audio');
  if (model.inputType === 'tts') inputs.push('text');
  if (model.inputType === 'music') inputs.push('text');

  // Check for optional extra inputs via paramConfig
  const imgParam = Models.getFileParam(model.id, 'imageUrls');
  const vidParam = Models.getFileParam(model.id, 'videoUrl');
  const audParam = Models.getFileParam(model.id, 'audioUrl');

  if (imgParam && !primaryIsImage) inputs.push('image');
  if (vidParam && !primaryIsVideo) inputs.push('video');
  if (audParam && !primaryIsAudio) inputs.push('audio');

  if (inputs.length <= 1) return base;
  return `${inputs.join('/')} → ${output}`;
}

export async function promptForModel(): Promise<ModelSelection | null> {
  let resolvedMode: GenerationMode = 'image';
  let resolvedModels: ModelDefinition[] = [];

  const steps: WizardStep[] = [
    {
      id: 'mode',
      run: async () => {
        const modeChoices = [
          {
            name: `${chalk.bold('image')}  ${chalk.dim('Generate images from text or images')}`,
            value: 'image' as GenerationMode,
          },
          {
            name: `${chalk.bold('video')}  ${chalk.dim('Create videos from text, images, or video')}`,
            value: 'video' as GenerationMode,
          },
          {
            name: `${chalk.bold('audio')}  ${chalk.dim('Generate music, speech, and sound effects')}`,
            value: 'audio' as GenerationMode,
          },
        ];
        const mode = await selectWithNav<GenerationMode>({
          message: `${chalk.hex('#E859B4')('✦')} What do you want to create?`,
          choices: modeChoices,
        });
        if (mode === BACK || mode === CANCEL) return mode;
        resolvedMode = mode;
        return mode;
      },
    },
    {
      id: 'model',
      run: async () => {
        const models = Models.list({ mode: resolvedMode }).filter((m) => !m.disabled);
        models.sort((a, b) => badgePriority(a) - badgePriority(b));
        resolvedModels = models;

        const selectedModel = await searchWithNav<ModelDefinition>({
          message: `${chalk.hex('#E859B4')('🔍')} Search models`,
          pageSize: PAGE_SIZE,
          source: async (term) => {
            const query = term ?? '';
            const matched = query
              ? fuzzyFilter(resolvedModels, query, (m) => `${m.name} ${m.id} ${m.provider}`)
              : resolvedModels;

            return matched.map((m) => {
              const badges = m.badge?.length
                ? m.badge.map((b) => renderPresetBadge(b, { color: getColor() })).join(' ')
                : '';
              const line2 = chalk.dim(`  ${friendlyInputType(m)} · ${m.provider}`);
              return {
                name: `${chalk.bold(m.name)}${badges ? `  ${badges}` : ''}\n${line2}`,
                value: m,
              };
            });
          },
        });

        if (selectedModel === BACK || selectedModel === CANCEL) return selectedModel;
        return selectedModel;
      },
    },
  ];

  const result = await runWizard(steps);
  if (!result) return null;

  return { model: result.model as ModelDefinition };
}

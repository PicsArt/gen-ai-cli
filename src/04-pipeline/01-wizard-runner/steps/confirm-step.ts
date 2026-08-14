/**
 * Wizard step: review & confirm before execution.
 *
 * Displays a summary card with model, prompt, files, and params,
 * then asks the user to "Run" or "Edit parameters".
 * Returns BACK if the user wants to revise, or true to proceed.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { renderCard } from '#infra/ui-core/components/card.ts';
import { renderKeyValue } from '#infra/ui-core/components/key-value.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import type { CliDeps } from '#root/deps.ts';
import type { ResolvedInputs } from '#root/types.ts';
import { selectWithNav } from '../nav.ts';

export type ConfirmResult = true | typeof CANCEL | 'edit-params' | 'edit-files';

export async function runConfirmStep(
  deps: CliDeps,
  model: ModelDefinition,
  prompt: string | undefined,
  files: ResolvedInputs['files'],
  params: Record<string, unknown>,
): Promise<ConfirmResult> {
  const { color, out } = deps;

  // Build summary pairs
  const pairs: [string, string][] = [];
  pairs.push(['model', `${model.name}  ${color.dim(`(${model.id})`)}`]);

  if (prompt) {
    const truncated = prompt.length > 80 ? `${prompt.slice(0, 77)}…` : prompt;
    pairs.push(['prompt', truncated]);
  }

  // Every slot the pipeline can carry — the user confirms what they see.
  const allFiles: string[] = [
    ...(files.images ?? []),
    ...(files.startFrame ? [files.startFrame] : []),
    ...(files.endFrame ? [files.endFrame] : []),
    ...(files.video ? [files.video] : []),
    ...(files.audio ? [files.audio] : []),
    ...(files.videos ?? []),
    ...(files.audios ?? []),
    ...(files.staticMask ? [files.staticMask] : []),
    ...(files.sceneImage ? [files.sceneImage] : []),
    ...(files.styleImage ? [files.styleImage] : []),
  ];
  if (allFiles.length > 0) {
    pairs.push(['files', allFiles.join(', ')]);
  }

  const paramEntries = Object.entries(params).filter(([k, v]) => v != null && k !== 'prompt');
  for (const [key, value] of paramEntries) {
    pairs.push([key, String(value)]);
  }

  // Render summary card
  const kvText = renderKeyValue(pairs, { color });
  const cardLines = kvText.split('\n').filter((line) => line.length > 0);
  const cardOutput = renderCard(cardLines, {
    color,
    title: 'Generation Summary',
    plain: deps.flags.plain,
  });

  out.result(cardOutput);

  // Warn about missing required inputs
  if (allFiles.length === 0 && params && Object.keys(params).length === 0 && !prompt) {
    out.warn('No inputs provided — generation will likely fail.');
  }

  // Ask to run or go back to edit
  const choices: { name: string; value: 'run' | 'edit' | 'files' }[] = [
    { name: color.success('▶  Run'), value: 'run' },
    { name: color.dim('✎  Edit parameters'), value: 'edit' },
    { name: color.dim('📁 Change files'), value: 'files' },
  ];

  const answer = await selectWithNav<'run' | 'edit' | 'files'>({
    message: 'Ready to generate?',
    choices,
    cancelOnly: false,
  });

  if (answer === CANCEL) return CANCEL;
  if (answer === BACK) return 'edit-params';
  if (answer === 'edit') return 'edit-params';
  if (answer === 'files') return 'edit-files';

  return true;
}

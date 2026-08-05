import type { ModelDefinition } from '@picsart/ai-sdk';
import { Models } from '@picsart/ai-sdk';
import type { ColorManager } from '../ui-core/color.ts';
import { renderDivider } from '../ui-core/components/divider.ts';
import { renderKeyValue } from '../ui-core/components/key-value.ts';

/**
 * Render model info as an array of lines suitable for renderCard().
 * Shared between `models info` and the interactive models list.
 */
export function renderModelInfoLines(model: ModelDefinition, color: ColorManager): string[] {
  const lines: string[] = [];

  const kv = renderKeyValue(
    [
      ['ID', model.id],
      ['Provider', model.provider],
      ['Mode', model.mode],
      ['Input Type', model.inputType],
      ['Status', model.disabled ? 'disabled' : 'enabled'],
      ['Workflow', model.workflow],
      ['Edit Workflow', model.editWorkflow ?? ''],
      ['Sync Execute', model.syncExecute ? 'yes' : 'no'],
      ['Model ID', model.modelId ?? ''],
      ['Features', model.features.map((f) => f.label).join(', ') || 'none'],
      ['Badge', model.badge?.join(', ') ?? ''],
    ],
    { color },
  );
  lines.push(...kv.split('\n'));

  const schema = Models.toSchema(model.id);
  const schemaKeys = Object.keys(schema);
  if (schemaKeys.length > 0) {
    lines.push('');
    lines.push(renderDivider({ color, label: 'Parameters', width: 40 }));
    lines.push('');
    const paramPairs: [string, string][] = schemaKeys.map((key) => {
      const param = schema[key];
      const opts = param.enum ? param.enum.join('  ') : (param.type ?? '');
      return [key, color.dim(opts)];
    });
    lines.push(...renderKeyValue(paramPairs, { color }).split('\n'));
  }

  return lines;
}

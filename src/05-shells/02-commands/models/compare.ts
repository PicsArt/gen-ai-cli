import { Args } from '@oclif/core';
import { findModel, Models } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';

function formatSchemaValue(schema: {
  type?: string;
  enum?: (string | number)[];
  min?: number;
  max?: number;
  default?: unknown;
}): string {
  if (schema.enum && schema.enum.length > 0) return schema.enum.join(',');
  if (schema.min != null || schema.max != null) return `${schema.min ?? ''}-${schema.max ?? ''}`;
  if (schema.type === 'boolean') return `yes (default: ${schema.default ?? false})`;
  if (schema.type === 'string') return schema.default ? String(schema.default) : 'text';
  return schema.type ?? 'yes';
}

export default class ModelsCompare extends BaseCommand {
  static description = 'Compare two models side-by-side';
  static examples = [
    { command: '<%= config.bin %> models compare flux-pro sora', description: 'Side-by-side comparison table' },
    { command: '<%= config.bin %> models compare flux-pro sora --json', description: 'Comparison as JSON' },
  ];

  static args = {
    modelA: Args.string({ description: 'First model ID or name', required: true }),
    modelB: Args.string({ description: 'Second model ID or name', required: true }),
  };

  static flags = {
    ...BaseCommand.baseFlags,
  };

  async run() {
    const { args } = await this.parse(ModelsCompare);

    const a = findModel(args.modelA);
    const b = findModel(args.modelB);

    if (!a) throw new UsageError(`Model not found: ${args.modelA}`);
    if (!b) throw new UsageError(`Model not found: ${args.modelB}`);

    const schemaA = Models.toSchema(a.id);
    const schemaB = Models.toSchema(b.id);

    if (this.isJsonMode) {
      this.out.json({
        models: [
          { id: a.id, name: a.name, provider: a.provider, mode: a.mode, inputType: a.inputType, schema: schemaA },
          { id: b.id, name: b.name, provider: b.provider, mode: b.mode, inputType: b.inputType, schema: schemaB },
        ],
      });
      return;
    }

    const fields: [string, string, string][] = [
      ['Name', a.name, b.name],
      ['Provider', a.provider, b.provider],
      ['Mode', a.mode, b.mode],
      ['Input Type', a.inputType, b.inputType],
      ['Workflow', a.workflow, b.workflow],
      ['Sync', a.syncExecute ? 'yes' : 'no', b.syncExecute ? 'yes' : 'no'],
    ];

    const allParams = new Set([...Object.keys(schemaA), ...Object.keys(schemaB)]);
    for (const param of allParams) {
      const sa = schemaA[param];
      const sb = schemaB[param];
      const va = sa ? formatSchemaValue(sa) : '-';
      const vb = sb ? formatSchemaValue(sb) : '-';
      fields.push([`param:${param}`, va, vb]);
    }

    const tableData = fields.map(([label, va, vb]) => ({
      field: label,
      [a.id]: va,
      [b.id]: vb,
    }));
    this.out.richTable(tableData, {
      columns: [
        { key: 'field', label: 'Field' },
        { key: a.id, label: a.id },
        { key: b.id, label: b.id },
      ],
    });
  }
}

import { Flags } from '@oclif/core';
import type { GenerationMode, ModelDefinition } from '@picsart/ai-sdk';
import { catalog, Model, Models } from '@picsart/ai-sdk';
import chalk from 'chalk';
import { selectWithNav } from '#pipeline/01-wizard-runner/nav.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { ensurePricingClient } from '#services/client.ts';
import { renderModelInfoLines } from '../../../01-infrastructure/ui/model-info.ts';
import { renderCard } from '../../../01-infrastructure/ui-core/components/card.ts';
import { badgePriority } from '../../../01-infrastructure/utils/badge-priority.ts';
import { BaseCommand } from '../../../base-command.ts';
import Generate from '../operations/generate.ts';

function formatCredits(model: ModelDefinition): string {
  const range = Model(model.id).getCreditsInfo();
  if (!range) return '-';
  const unit = range.unit ?? '';
  const value = range.min === range.max ? `${range.min}` : `${range.min}\u2013${range.max}`;
  return unit ? `${value}/${unit}` : value;
}

function summarizeParams(model: ModelDefinition): string {
  const schema = Models.toSchema(model.id);
  const keys = Object.keys(schema);
  if (keys.length === 0) return '-';
  return keys
    .map((k) => {
      const s = schema[k];
      if (s.enum) return `${k}(${s.enum.length})`;
      if (s.min != null) return `${k}[${s.min}-${s.max}]`;
      if (s.type === 'boolean') return k;
      if (s.type === 'file') return `${k}${s.required ? '*' : ''}`;
      return k;
    })
    .join(', ');
}

export default class ModelsList extends BaseCommand {
  static description = 'List available models';
  static examples = [
    { command: '<%= config.bin %> models', description: 'List all enabled models' },
    {
      command: '<%= config.bin %> models --mode video --provider google --params',
      description: 'Google video models with parameter details',
    },
    { command: '<%= config.bin %> models --json | jq ".[].id"', description: 'Extract all model IDs as JSON' },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    mode: Flags.string({ description: 'Filter by generation mode (video|image|audio)' }),
    provider: Flags.string({ description: 'Filter by provider name' }),
    'input-type': Flags.string({ description: 'Filter by input type (t2v|i2v|t2i|...)' }),
    disabled: Flags.boolean({ description: 'Include disabled models', default: false }),
    params: Flags.boolean({ description: 'Show parameter summary in list view', default: false }),
  };

  async run() {
    const { flags } = await this.parse(ModelsList);

    // Load pricing so formatCredits() can render real values instead of '-'.
    // Failures are swallowed: the list still renders without credit data.
    await ensurePricingClient();
    await catalog.pricing.load().catch(() => undefined);

    let models = flags.mode ? Models.list({ mode: flags.mode as GenerationMode }) : Models.list();

    if (!flags.disabled) models = models.filter((m) => !m.disabled);

    if (flags.provider) {
      const p = flags.provider.toLowerCase();
      models = models.filter((m) => m.provider.toLowerCase() === p);
    }

    if (flags['input-type']) {
      const it = flags['input-type'].toLowerCase();
      models = models.filter((m) => m.inputType === it);
    }

    models.sort((a, b) => badgePriority(a) - badgePriority(b));

    if (this.isJsonMode) {
      this.out.json(
        models.map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          mode: m.mode,
          inputType: m.inputType,
          disabled: m.disabled ?? false,
          workflow: m.workflow,
          ...(flags.params ? { params: Object.keys(Models.toSchema(m.id)) } : {}),
        })),
      );
      return;
    }

    // Interactive mode: table rows are selectable choices
    if (!this.noInput && !this.isPlainMode) {
      await this.interactiveTable(models, flags.params);
      return;
    }

    // Non-interactive: static table
    this.printStaticTable(models, flags.params);
  }

  private printStaticTable(models: ModelDefinition[], showParams: boolean): void {
    if (showParams) {
      this.out.richTable(
        models.map((m) => ({
          id: m.id,
          provider: m.provider,
          mode: m.mode,
          input: m.inputType,
          credits: formatCredits(m),
          parameters: summarizeParams(m),
        })),
        {
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'provider', label: 'Provider' },
            { key: 'mode', label: 'Mode' },
            { key: 'input', label: 'Input' },
            { key: 'credits', label: 'Credits' },
            { key: 'parameters', label: 'Parameters' },
          ],
        },
      );
    } else {
      this.out.richTable(
        models.map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          mode: m.mode,
          input: m.inputType,
          credits: formatCredits(m),
        })),
        {
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name' },
            { key: 'provider', label: 'Provider' },
            { key: 'mode', label: 'Mode' },
            { key: 'input', label: 'Input' },
            { key: 'credits', label: 'Credits' },
          ],
        },
      );
    }
    if (!this.isQuiet) this.out.result(`\n${models.length} models`);
  }

  private async interactiveTable(models: ModelDefinition[], showParams: boolean): Promise<void> {
    // Compute column widths from data
    const cols = showParams
      ? [
          { key: 'id', label: 'ID' },
          { key: 'provider', label: 'Provider' },
          { key: 'mode', label: 'Mode' },
          { key: 'input', label: 'Input' },
          { key: 'credits', label: 'Credits' },
          { key: 'params', label: 'Parameters' },
        ]
      : [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'provider', label: 'Provider' },
          { key: 'mode', label: 'Mode' },
          { key: 'input', label: 'Input' },
          { key: 'credits', label: 'Credits' },
        ];

    const rows = models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      mode: m.mode,
      input: m.inputType,
      credits: formatCredits(m),
      params: showParams ? summarizeParams(m) : '',
    }));

    // Calculate column widths (max of header + all values)
    const widths = cols.map((col) => {
      let max = col.label.length;
      for (const row of rows) {
        const val = (row as Record<string, string>)[col.key] ?? '';
        if (val.length > max) max = val.length;
      }
      return max;
    });

    const gap = '  ';
    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));

    // Print header
    const header = cols.map((col, i) => chalk.bold(pad(col.label, widths[i]))).join(gap);
    const separator = this.color.dim(
      '\u2500'.repeat(widths.reduce((s, w) => s + w, 0) + gap.length * (cols.length - 1)),
    );
    process.stderr.write(`  ${header}\n  ${separator}\n`);

    // Build choices as aligned table rows
    const choices = models.map((m, idx) => {
      const row = rows[idx];
      const line = cols
        .map((col, i) => {
          const val = (row as Record<string, string>)[col.key] ?? '';
          // First column bold, rest dim
          return i === 0 ? chalk.bold(pad(val, widths[i])) : chalk.dim(pad(val, widths[i]));
        })
        .join(gap);
      return { name: line, value: m.id };
    });

    while (true) {
      const selected = await selectWithNav<string>({
        message: `${models.length} models \u2014 arrow keys to browse, enter to select`,
        choices,
        pageSize: 15,
        cancelOnly: true,
      });

      if (selected === BACK || selected === CANCEL) return;

      const model = models.find((m) => m.id === selected);
      if (!model) continue;

      // Show full model info card (same as `models info`)
      const infoLines = renderModelInfoLines(model, this.color);
      process.stderr.write(
        '\n' +
          renderCard(infoLines, {
            color: this.color,
            title: model.name,
            maxWidth: Math.min(process.stdout.columns || 100, 100),
            plain: this.isPlainMode,
          }) +
          '\n',
      );

      // Action menu
      const action = await selectWithNav<string>({
        message: model.name,
        choices: [
          { name: `\u{26A1}  ${chalk.bold('Generate with this model')}  ${chalk.dim(model.id)}`, value: 'generate' },
          { name: `\u{1F519}  ${chalk.bold('Back to list')}`, value: 'back' },
        ],
      });

      if (action === 'generate') {
        await Generate.run(['--model', model.id]);
        return;
      }
    }
  }
}

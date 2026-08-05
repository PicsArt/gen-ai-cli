import { Args, Flags } from '@oclif/core';
import type { CreditRange, CreditRangeContext, GenerationMode } from '@picsart/ai-sdk';
import { catalog, findModel, Model } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { renderKeyValue } from '#infra/ui-core/components/key-value.ts';
import { BaseCommand } from '#root/base-command.ts';
import { ensurePricingClient } from '#services/client.ts';

/** Multiply a per-unit range by `duration` when the unit is time-based.
 *  Returns the range unchanged for non-time units or when duration is missing. */
function scaleByDuration(range: CreditRange, duration: number | undefined): CreditRange {
  if (duration == null || range.unit !== 'second') return range;
  return { ...range, min: range.min * duration, max: range.max * duration };
}

function formatCreditsLabel(range: CreditRange | null): string {
  if (!range) return 'not available';
  const value = range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
  return range.unit ? `${value}/${range.unit}` : value;
}

export default class Pricing extends BaseCommand {
  static description = 'Show credit costs for models';

  static examples = [
    { command: '<%= config.bin %> pricing', description: 'Show pricing for all models' },
    {
      command: '<%= config.bin %> pricing kling-v3-pro -d 5 --resolution 1080p --audio',
      description: 'Calculate cost for 5s video with resolution and audio',
    },
    { command: '<%= config.bin %> pricing --mode video --json', description: 'All video model pricing as JSON' },
  ];

  static args = {
    model: Args.string({ description: 'Model ID or name', required: false }),
  };

  static flags = {
    ...BaseCommand.baseFlags,
    all: Flags.boolean({ description: 'Show all models', default: false }),
    mode: Flags.string({ description: 'Filter by mode (with --all)' }),
    duration: Flags.integer({ description: 'Multiply per-second credits by this duration (seconds)' }),
    resolution: Flags.string({ description: 'Narrow pricing to a specific resolution' }),
    audio: Flags.boolean({ description: 'Narrow pricing to entries with/without audio', allowNo: true }),
  };

  async run() {
    const { args, flags } = await this.parse(Pricing);

    const implicitAll = !args.model && !flags.all;
    if (!args.model) flags.all = true;

    await ensurePricingClient();
    await catalog.pricing.load();

    if (flags.all) {
      const models = flags.mode ? catalog.find({ output: flags.mode as GenerationMode }) : catalog.all();

      if (this.isJsonMode) {
        this.out.json(
          models.map((m) => {
            const range = m.getCreditsInfo();
            return {
              id: m.id,
              name: m.name,
              provider: m.meta().provider.id,
              mode: m.meta().mode,
              creditRange: range,
            };
          }),
        );
        return;
      }

      const tableData = models.map((m) => {
        const range = m.getCreditsInfo();
        let credits = '-';
        if (range) {
          credits = range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
        }
        return {
          id: m.id,
          name: m.name,
          provider: m.meta().provider.id,
          mode: m.meta().mode,
          credits,
        };
      });
      this.out.richTable(tableData, {
        columns: [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'provider', label: 'Provider' },
          { key: 'mode', label: 'Mode' },
          { key: 'credits', label: 'Credits', align: 'right' },
        ],
      });
      if (!this.isQuiet) {
        this.out.info(`${models.length} models`);
        if (implicitAll) {
          this.out.info('');
          this.out.info('Quick reference:');
          this.out.info('  pricing flux-2-pro                       Single model pricing');
          this.out.info('  pricing kling-v3-pro --duration 5       Cost for 5s video');
          this.out.info('  pricing --mode video                     Filter by mode');
          this.out.info('  pricing --json                           JSON output');
          this.out.info('');
          this.out.info('Related:');
          this.out.info('  models                                   List all models');
          this.out.info('  models info flux-2-pro                   Detailed model info');
          this.out.info('  models compare flux-2-pro kling-v3-pro  Side-by-side comparison');
          this.out.info('  history                                  Recent generations');
        }
      }
      return;
    }

    const model = findModel(args.model!);
    if (!model) {
      throw new UsageError(`Model not found: ${args.model}\n\nExamples:\n  pricing flux-2-pro\n  pricing --all`);
    }

    const descriptor = Model(model.id);
    const meta = descriptor.meta();

    const ctx: CreditRangeContext = {};
    if (flags.resolution != null) ctx.resolution = flags.resolution;
    if (flags.audio != null) ctx.generateAudio = flags.audio;

    const baseRange = descriptor.getCreditsInfo(Object.keys(ctx).length ? ctx : undefined);
    const scaledRange = baseRange ? scaleByDuration(baseRange, flags.duration) : null;
    const totalLabel = scaledRange
      ? scaledRange.min === scaledRange.max
        ? `${scaledRange.min}`
        : `${scaledRange.min}–${scaledRange.max}`
      : 'not available';

    if (this.isJsonMode) {
      this.out.json({
        id: model.id,
        name: model.name,
        provider: meta.provider.id,
        mode: meta.mode,
        creditRange: baseRange,
        ...(Object.keys(ctx).length > 0 ? { context: ctx } : {}),
        ...(flags.duration != null && baseRange?.unit === 'second'
          ? { totalCredits: scaledRange, duration: flags.duration }
          : {}),
      });
      return;
    }

    const pairs: [string, string][] = [
      ['Name', `${model.name} (${model.id})`],
      ['Provider', meta.provider.name],
      ['Mode', meta.mode],
      ['Per-unit', formatCreditsLabel(baseRange)],
    ];
    if (flags.resolution != null) pairs.push(['Resolution', flags.resolution]);
    if (flags.audio != null) pairs.push(['Audio', String(flags.audio)]);
    if (flags.duration != null) pairs.push(['Duration', `${flags.duration}s`]);
    if (flags.duration != null && baseRange?.unit === 'second') {
      pairs.push(['Total credits', totalLabel]);
    }

    const kv = renderKeyValue(pairs, { color: this.color });
    this.out.card(kv.split('\n'), {
      title: `Pricing: ${model.name}`,
    });
  }
}

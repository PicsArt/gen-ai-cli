/**
 * compare — run the same prompt across multiple models and show them
 * side-by-side, so you can pick the best model for a brief.
 *
 * Implemented on top of the batch runner: a comparison is just a batch where
 * every job shares the prompt and varies the model. That gives parallel
 * execution, auth, and per-job results (status / url / duration) for free.
 *
 * Each model is a real generation, so this spends credits per model.
 */
import { Flags } from '@oclif/core';
import { findModel, type ModelDefinition } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { truncate } from '#infra/ui-core/components/string-utils.ts';
import { BaseCommand } from '#root/base-command.ts';
import type { BatchManifest } from '#shells/02-commands/batch/helpers.ts';
import { downloadResults, runBatchWithAuth } from '#shells/02-commands/batch/helpers.ts';
import { enforceMaxCostForModels } from '../../01-command-builder/helpers/max-cost.ts';

/** Flatten comma-separated and repeated `-m` values into a clean, de-duped list. */
export function parseCompareModels(modelFlags: string[] | undefined): string[] {
  const refs = (modelFlags ?? [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(refs)];
}

/** Resolve model refs to definitions; throws a clear UsageError on the first unknown id. */
export function resolveCompareModels(refs: string[]): ModelDefinition[] {
  return refs.map((ref) => {
    const model = findModel(ref);
    if (!model) throw new UsageError(`Model not found: "${ref}". Run "gen-ai models" to see available models.`);
    return model;
  });
}

function elapsed(ms?: number): string {
  if (!ms) return '-';
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default class Compare extends BaseCommand {
  static description = 'Run one prompt across multiple models and compare the results';

  static examples = [
    {
      command: '<%= config.bin %> compare -p "a fox in the woods" -m flux-1.1-pro,gpt-image-2',
      description: 'Compare two image models',
    },
    { command: '<%= config.bin %> compare -p "..." -m a -m b -m c --json', description: 'Three models, JSON output' },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    prompt: Flags.string({ char: 'p', description: 'Prompt to run on every model', required: true }),
    model: Flags.string({
      char: 'm',
      description: 'Model to compare (comma-separated or repeat -m); 2+ required',
      multiple: true,
    }),
    concurrency: Flags.integer({ char: 'c', description: 'Max parallel generations', default: 3 }),
    download: Flags.string({ description: 'Download each result into this directory (named by model id)' }),
    'max-cost': Flags.integer({
      description: 'Abort if the estimated TOTAL cost across all models exceeds this many credits',
    }),
  };

  async run() {
    const { flags } = await this.parse(Compare);

    const refs = parseCompareModels(flags.model);
    if (refs.length < 2) {
      throw new UsageError('Compare needs at least 2 models, e.g. `-m flux-1.1-pro,gpt-image-2`.');
    }
    const models = resolveCompareModels(refs);

    // Cost ceiling across all models (each model is one real generation).
    if (typeof flags['max-cost'] === 'number') {
      await enforceMaxCostForModels(models, { prompt: flags.prompt }, flags['max-cost'], this.out);
    }

    // One batch job per model — same prompt, varying model.
    const manifest: BatchManifest = {
      jobs: models.map((model) => ({ id: model.id, model: model.id, prompt: flags.prompt })),
    };

    if (!this.isQuiet) {
      this.out.info(`Comparing ${models.length} models on: "${truncate(flags.prompt, 60)}"`);
    }

    const results = await runBatchWithAuth(manifest, { concurrency: flags.concurrency, output: '' });

    // Optional: persist each result locally (sets job.localPath, named by model id).
    if (flags.download) {
      await downloadResults(results, flags.download, flags.concurrency);
    }

    if (this.isJsonMode) {
      this.out.json({ prompt: flags.prompt, results: results.jobs });
      return;
    }

    // Preserve the requested model order in the comparison table.
    const byId = new Map(results.jobs.map((job) => [job.id, job]));
    const rows = models.map((model) => {
      const job = byId.get(model.id);
      const ok = job?.status === 'completed';
      return {
        model: model.name,
        provider: model.provider,
        status: ok ? this.color.green('OK') : this.color.red('FAIL'),
        time: elapsed(job?.durationMs),
        result: ok ? (job?.url ?? '-') : truncate(job?.error ?? 'no result', 48),
      };
    });

    this.out.richTable(rows, {
      columns: [
        { key: 'model', label: 'Model' },
        { key: 'provider', label: 'Provider' },
        { key: 'status', label: 'Status' },
        { key: 'time', label: 'Time' },
        { key: 'result', label: 'Result' },
      ],
    });

    // Full result below (the table truncates long links). Prefer the saved
    // local path when --download was used, otherwise the CDN URL.
    for (const model of models) {
      const job = byId.get(model.id);
      if (job?.status !== 'completed') continue;
      const location = job.localPath ?? job.url;
      if (location) this.out.result(`${model.name}: ${location}`);
    }
  }
}

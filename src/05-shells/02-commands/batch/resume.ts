/**
 * batch resume — re-run failed jobs from a previous batch.
 *
 * Reads results.json, re-runs only the failed jobs using the original manifest,
 * then merges results (keeping prior successes) and saves the updated results.json.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Args, Flags } from '@oclif/core';
import { FileError } from '#infra/errors/file.ts';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';
import type { BatchManifest, BatchResults, JobResult } from '#shells/02-commands/batch/helpers.ts';
import {
  applyManifestDefaults,
  printSummary,
  runBatchWithAuth,
  saveAndDownload,
} from '#shells/02-commands/batch/helpers.ts';

export default class BatchResume extends BaseCommand {
  static description = 'Re-run failed jobs from a previous batch';

  static examples = [
    '<%= config.bin %> batch resume ./batch-output',
    '<%= config.bin %> batch resume ./batch-output --concurrency 5',
  ];

  static args = {
    file: Args.string({
      description: 'Output directory containing results.json from a previous batch run',
      required: true,
    }),
  };

  static flags = {
    ...BaseCommand.baseFlags,
    concurrency: Flags.integer({
      char: 'c',
      description: 'Max parallel jobs',
      default: 3,
    }),
    'no-download': Flags.boolean({
      description: 'Skip downloading newly completed results',
      default: false,
    }),
    'download-concurrency': Flags.integer({
      description: 'Parallel download workers',
      default: 3,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(BatchResume);

    // The output dir is the directory arg, not the --output flag (resume uses existing dir)
    const outputDir = args.file;
    const resultsPath = path.join(outputDir, 'results.json');

    if (!fs.existsSync(resultsPath)) {
      throw new FileError(resultsPath, 'results.json not found — run batch first');
    }

    let prev: BatchResults;
    try {
      prev = JSON.parse(fs.readFileSync(resultsPath, 'utf-8')) as BatchResults;
    } catch {
      throw new FileError(resultsPath, 'Failed to parse results.json');
    }

    const failedIds = new Set(prev.jobs.filter((j) => j.status === 'failed').map((j) => j.id));

    if (failedIds.size === 0) {
      this.out.success('No failed jobs to resume');
      return;
    }

    if (!prev.manifestPath || !fs.existsSync(prev.manifestPath)) {
      throw new UsageError('Original manifest not found. Use: gen-ai batch run <manifest.json>');
    }

    let manifest: BatchManifest;
    try {
      const raw = fs.readFileSync(prev.manifestPath, 'utf-8');
      manifest = JSON.parse(raw) as BatchManifest;
    } catch {
      throw new FileError(prev.manifestPath, 'Failed to parse original manifest');
    }

    // Filter to only the failed jobs
    manifest.jobs = manifest.jobs.filter((j) => failedIds.has(j.id));
    applyManifestDefaults(manifest);

    this.out.info(`Resuming ${manifest.jobs.length} failed job(s)...`);

    const results = await runBatchWithAuth(manifest, {
      concurrency: flags.concurrency,
      output: outputDir,
    });

    results.manifestPath = prev.manifestPath;

    // Merge: keep previous successes, replace re-run results
    const rerunIds = new Set(results.jobs.map((j) => j.id));
    const merged: JobResult[] = [...prev.jobs.filter((j) => !rerunIds.has(j.id)), ...results.jobs];
    results.jobs = merged;

    printSummary(results, 'Resume complete');

    await saveAndDownload(results, outputDir, {
      noDownload: flags['no-download'],
      downloadConcurrency: flags['download-concurrency'],
    });
  }
}

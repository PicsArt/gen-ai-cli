/**
 * batch status — display a summary of a previous batch run.
 *
 * Reads results.json from the output directory and prints completed/failed totals
 * along with details for any failed jobs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Args } from '@oclif/core';
import { FileError } from '#infra/errors/file.ts';
import { BaseCommand } from '#root/base-command.ts';
import type { BatchResults } from '#shells/02-commands/batch/helpers.ts';

export default class BatchStatus extends BaseCommand {
  static description = 'Show summary of a previous batch run';

  static examples = [
    '<%= config.bin %> batch status ./batch-output',
    '<%= config.bin %> batch status ./batch-output --json',
  ];

  static args = {
    file: Args.string({
      description: 'Output directory containing results.json (or path to results.json)',
      required: true,
    }),
  };

  static flags = {
    ...BaseCommand.baseFlags,
  };

  async run() {
    const { args } = await this.parse(BatchStatus);

    // Accept either the directory or a direct path to results.json
    const resultsPath = args.file.endsWith('results.json') ? args.file : path.join(args.file, 'results.json');

    if (!fs.existsSync(resultsPath)) {
      throw new FileError(resultsPath, 'results.json not found — has a batch been run yet?');
    }

    let results: BatchResults;
    try {
      results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8')) as BatchResults;
    } catch {
      throw new FileError(resultsPath, 'Failed to parse results.json');
    }

    if (this.isJsonMode) {
      this.out.json(results);
      return;
    }

    const completed = results.jobs.filter((j) => j.status === 'completed').length;
    const failed = results.jobs.filter((j) => j.status === 'failed').length;
    const total = results.jobs.length;

    this.out.result(`Status: ${completed}/${total} completed, ${failed} failed`);

    if (results.startedAt) {
      this.out.info(`Started:   ${results.startedAt}`);
    }
    if (results.completedAt) {
      this.out.info(`Completed: ${results.completedAt}`);
    }
    if (results.manifestPath) {
      this.out.info(`Manifest:  ${results.manifestPath}`);
    }

    const failedJobs = results.jobs.filter((j) => j.status === 'failed');
    if (failedJobs.length > 0) {
      this.out.warn('\nFailed jobs:');
      for (const j of failedJobs) {
        this.out.error(`  ${j.id}: ${j.error ?? 'unknown error'}`);
      }
    }
  }
}

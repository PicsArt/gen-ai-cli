/**
 * batch run — execute jobs from a JSON manifest file.
 *
 * Loads a manifest, validates all jobs, runs them with concurrency control,
 * saves results.json, and optionally downloads completed outputs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Args, Flags } from '@oclif/core';
import { findModel } from '@picsart/ai-sdk';
import { FileError } from '#infra/errors/file.ts';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';
import type { BatchManifest } from '#shells/02-commands/batch/helpers.ts';
import {
  applyManifestDefaults,
  printSummary,
  runBatchWithAuth,
  saveAndDownload,
} from '#shells/02-commands/batch/helpers.ts';
import { validateManifestStructure } from '#shells/02-commands/batch/manifest-schema.ts';

export default class BatchRun extends BaseCommand {
  static description = 'Run batch jobs from a manifest file';

  static examples = [
    { command: '<%= config.bin %> batch run manifest.json', description: 'Run all jobs in manifest' },
    {
      command: '<%= config.bin %> batch run manifest.json -c 5 -o ./results',
      description: '5 concurrent jobs, download outputs to ./results',
    },
    {
      command: '<%= config.bin %> batch run manifest.json --dry-run',
      description: 'Validate manifest without executing',
    },
    {
      command: '<%= config.bin %> batch run manifest.json --no-download',
      description: 'Run without downloading result files; write results.json only',
    },
  ];

  static args = {
    file: Args.string({
      description: 'Path to the batch manifest JSON file',
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
    output: Flags.string({
      char: 'o',
      description: 'Output directory for results and downloads',
      default: './batch-output',
    }),
    'dry-run': Flags.boolean({
      description: 'Validate manifest without executing jobs',
      default: false,
    }),
    'no-download': Flags.boolean({
      description: 'Skip downloading completed results',
      default: false,
    }),
    'download-concurrency': Flags.integer({
      description: 'Parallel download workers',
      default: 3,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(BatchRun);

    if (!fs.existsSync(args.file)) {
      throw new FileError(args.file, 'Manifest file not found');
    }

    const stat = fs.statSync(args.file);
    if (stat.size > 10 * 1024 * 1024) {
      throw new UsageError(`Manifest file too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max allowed: 10MB.`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(args.file, 'utf-8'));
    } catch {
      throw new FileError(args.file, 'Failed to parse manifest as JSON');
    }

    // Structural validation against the manifest schema (run `gen-ai batch
    // schema` for the full contract). Fails clearly before any model lookup.
    const structuralErrors = validateManifestStructure(parsed);
    if (structuralErrors.length > 0) {
      throw new UsageError(`Invalid manifest:\n  - ${structuralErrors.join('\n  - ')}`);
    }

    const manifest = parsed as BatchManifest;
    applyManifestDefaults(manifest);

    // Validate all jobs have a model
    const noModel = manifest.jobs.filter((j) => !j.model);
    if (noModel.length > 0) {
      throw new UsageError(`Jobs missing model (and no defaults.model): ${noModel.map((j) => j.id).join(', ')}`);
    }

    // Validate all models exist
    const invalid = manifest.jobs.filter((j) => !findModel(j.model));
    if (invalid.length > 0) {
      throw new UsageError(`Unknown models: ${invalid.map((j) => `${j.id}:${j.model}`).join(', ')}`);
    }

    if (flags['dry-run']) {
      this.out.success(`Manifest valid: ${manifest.jobs.length} jobs`);
      for (const j of manifest.jobs) {
        this.out.info(`  ${j.id}: ${j.model} — ${j.prompt ?? '(no prompt)'}`);
      }
      return;
    }

    const results = await runBatchWithAuth(manifest, {
      concurrency: flags.concurrency,
      output: flags.output,
    });

    results.manifestPath = path.resolve(args.file);
    printSummary(results);

    await saveAndDownload(results, flags.output, {
      noDownload: flags['no-download'],
      downloadConcurrency: flags['download-concurrency'],
    });
  }
}

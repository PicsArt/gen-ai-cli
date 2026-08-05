/**
 * Redo command — re-run the last generation with optional overrides.
 * Usage: gen-ai redo [--prompt "new prompt"] [--model new-model] [other generate flags]
 */
import { Flags } from '@oclif/core';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getLastEntry } from '#services/history.ts';
import Generate from '../operations/generate.ts';
import { type ReplayOverrides, reconstructGenerateArgs } from './reconstruct-args.ts';

export default class Redo extends BaseCommand {
  static description = 'Re-run the last generation with optional overrides';

  static examples = [
    { command: '<%= config.bin %> redo', description: 'Re-run last generation as-is' },
    {
      command: '<%= config.bin %> redo -p "new prompt" -m veo-3.1 --ar 16:9 -d 10',
      description: 'Override prompt, model, aspect ratio, and duration',
    },
    {
      command: '<%= config.bin %> redo --download ./output',
      description: 'Re-run and download the result',
    },
  ];

  static flags = {
    ...BaseCommand.baseFlags,

    model: Flags.string({
      char: 'm',
      description: 'Override model',
    }),
    prompt: Flags.string({
      char: 'p',
      description: 'Override prompt',
    }),
    duration: Flags.integer({
      description: 'Override duration in seconds',
    }),
    'aspect-ratio': Flags.string({
      description: 'Override aspect ratio (e.g. 16:9)',
      aliases: ['ar'],
    }),
    resolution: Flags.string({
      description: 'Override resolution (e.g. 1080p)',
    }),
    count: Flags.integer({
      description: 'Override number of outputs',
    }),
    silent: Flags.boolean({
      char: 's',
      description: 'Skip interactive prompts, use model defaults',
      default: false,
    }),
    download: Flags.string({
      description: 'Download result to directory',
    }),
  };

  async run() {
    const { flags } = await this.parse(Redo);

    const last = getLastEntry();
    if (!last) {
      throw new UsageError('No previous generation found. Run "gen-ai generate" first.');
    }

    const reconstructed = reconstructGenerateArgs(last, flags as ReplayOverrides);

    this.out.info(
      `Redoing: ${last.modelName} — ${last.prompt?.slice(0, 60) ?? '(no prompt)'}${last.prompt && last.prompt.length > 60 ? '\u2026' : ''}`,
    );

    await Generate.run(reconstructed);
  }
}

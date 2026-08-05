/**
 * Replay command — re-run a specific past generation by its stable id.
 * Usage: gen-ai replay <id> [--prompt "..."] [--model ...] [other overrides]
 *
 * Unlike `redo` (always the last generation), `replay` targets any entry by the
 * stable id shown in `gen-ai history`. The id never shifts as new generations
 * are added, so it's safe to copy-paste or script.
 */
import { Args, Flags } from '@oclif/core';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getEntryById } from '#services/history.ts';
import Generate from '../operations/generate.ts';
import { type ReplayOverrides, reconstructGenerateArgs } from './reconstruct-args.ts';

export default class Replay extends BaseCommand {
  static description = 'Re-run a past generation by its id (see `gen-ai history`)';

  static examples = [
    { command: '<%= config.bin %> replay g_1a2b3c4d', description: 'Re-run that generation as-is' },
    {
      command: '<%= config.bin %> replay 1a2b -p "new prompt"',
      description: 'Match by id prefix, override the prompt',
    },
  ];

  static args = {
    id: Args.string({ description: 'History entry id (or unique prefix) from `gen-ai history`', required: true }),
  };

  static flags = {
    ...BaseCommand.baseFlags,
    model: Flags.string({ char: 'm', description: 'Override model' }),
    prompt: Flags.string({ char: 'p', description: 'Override prompt' }),
    duration: Flags.integer({ description: 'Override duration in seconds' }),
    'aspect-ratio': Flags.string({ description: 'Override aspect ratio (e.g. 16:9)', aliases: ['ar'] }),
    resolution: Flags.string({ description: 'Override resolution (e.g. 1080p)' }),
    count: Flags.integer({ description: 'Override number of outputs' }),
    silent: Flags.boolean({ char: 's', description: 'Skip interactive prompts, use model defaults', default: false }),
    download: Flags.string({ description: 'Download result to directory' }),
  };

  async run() {
    const { args, flags } = await this.parse(Replay);

    const { entry, ambiguous } = getEntryById(args.id);
    if (ambiguous) {
      throw new UsageError(
        `Ambiguous id "${args.id}" — more than one entry matches. Use a longer id from "gen-ai history".`,
      );
    }
    if (!entry) {
      throw new UsageError(`No history entry found for "${args.id}". Run "gen-ai history" to see ids.`);
    }

    const reconstructed = reconstructGenerateArgs(entry, flags as ReplayOverrides);

    const promptPreview = entry.prompt?.slice(0, 60) ?? '(no prompt)';
    const ellipsis = entry.prompt && entry.prompt.length > 60 ? '…' : '';
    this.out.info(`Replaying ${entry.id}: ${entry.modelName} — ${promptPreview}${ellipsis}`);

    await Generate.run(reconstructed);
  }
}

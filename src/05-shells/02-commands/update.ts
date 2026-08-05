import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { BaseCommand } from '#root/base-command.ts';
import { CLI_VERSION } from '#services/constants.ts';
import { performUpdate } from '#services/self-update.ts';

export default class Update extends BaseCommand {
  static override description = 'Update picsart CLI to the latest version';

  static override examples = ['<%= config.bin %> update', '<%= config.bin %> update --force'];

  static override flags = {
    ...BaseCommand.baseFlags,
    force: Flags.boolean({
      description: 'Reinstall even if already on latest version',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Update);

    this.out.info(`Current version: ${chalk.dim(CLI_VERSION)}`);
    this.out.info('Checking for updates...');

    const result = await performUpdate({ force: flags.force, currentVersion: CLI_VERSION });

    if (result.updated) {
      this.out.info(chalk.green(`\u2713 ${result.message}`));
      this.out.info('Restart your terminal to use the new version.');
    } else {
      this.out.info(result.message);
    }
  }
}

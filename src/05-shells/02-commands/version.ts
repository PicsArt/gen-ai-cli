import chalk from 'chalk';
import { BaseCommand } from '#root/base-command.ts';
import { CLI_VERSION } from '#services/constants.ts';

export default class Version extends BaseCommand {
  static override description = 'Show current CLI version';

  static override examples = ['<%= config.bin %> version', '<%= config.bin %> version --json'];

  async run(): Promise<void> {
    if (this.isJsonMode) {
      this.out.json({
        version: CLI_VERSION,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      });
      return;
    }

    this.out.info(
      `gen-ai ${chalk.bold(CLI_VERSION)}  ${this.color.dim(`node ${process.version} · ${process.platform}-${process.arch}`)}`,
    );
  }
}

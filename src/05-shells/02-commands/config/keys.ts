import { BaseCommand } from '#root/base-command.ts';
import { getConfigKeys } from '#services/user-config.ts';

export default class ConfigKeys extends BaseCommand {
  static description = 'List valid configuration keys';
  static examples = [
    { command: '<%= config.bin %> config keys', description: 'Show all valid keys' },
    { command: '<%= config.bin %> config keys --json', description: 'Output keys as JSON array' },
  ];

  async run() {
    const keys = getConfigKeys();
    if (this.isJsonMode) {
      this.out.json(keys);
      return;
    }
    this.out.info('Valid config keys:');
    for (const key of keys) {
      this.out.info(`  ${key}`);
    }
  }
}

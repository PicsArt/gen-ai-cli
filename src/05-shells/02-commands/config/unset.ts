import { Args } from '@oclif/core';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getConfigKeys, unsetConfigValue } from '#services/user-config.ts';

export default class ConfigUnset extends BaseCommand {
  static description = 'Remove a configuration value (reverts to default)';
  static examples = [
    { command: '<%= config.bin %> config unset defaultModel', description: 'Clear default model' },
    { command: '<%= config.bin %> config unset downloadDir', description: 'Reset download directory to ./output' },
  ];
  static args = {
    key: Args.string({ description: 'Config key', required: true }),
  };

  async run() {
    const { args } = await this.parse(ConfigUnset);
    const validKeys = getConfigKeys();
    if (!validKeys.includes(args.key)) {
      throw new UsageError(`Unknown config key: "${args.key}". Valid keys: ${validKeys.join(', ')}`);
    }
    unsetConfigValue(args.key);
    this.out.success(`${args.key} unset`);
  }
}

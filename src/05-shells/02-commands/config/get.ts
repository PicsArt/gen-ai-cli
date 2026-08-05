import { Args } from '@oclif/core';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getConfigKeys, getUserConfig } from '#services/user-config.ts';

export default class ConfigGet extends BaseCommand {
  static description = 'Get a configuration value';
  static examples = [
    { command: '<%= config.bin %> config get defaultModel', description: 'Show current default model' },
    { command: '<%= config.bin %> config get downloadDir', description: 'Show download directory' },
    { command: '<%= config.bin %> config get autoUpdate', description: 'Check if auto-update is enabled' },
  ];
  static args = {
    key: Args.string({ description: 'Config key', required: true }),
  };

  async run() {
    const { args } = await this.parse(ConfigGet);
    const validKeys = getConfigKeys();
    if (!validKeys.includes(args.key)) {
      throw new UsageError(`Unknown config key: "${args.key}". Valid keys: ${validKeys.join(', ')}`);
    }
    const config = getUserConfig();
    const value = (config as Record<string, unknown>)[args.key];
    if (value === undefined) {
      this.out.info(`${args.key} is not set`);
    } else {
      this.out.result(String(value));
    }
  }
}

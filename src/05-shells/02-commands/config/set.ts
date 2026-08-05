import { Args } from '@oclif/core';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getConfigKeys, setConfigValue } from '#services/user-config.ts';

export default class ConfigSet extends BaseCommand {
  static summary = 'Set a configuration value';
  static description = `Available keys:
  defaultModel      string   Default model for generate (e.g. flux-pro)
  downloadDir       string   Default download directory (absolute path)
  autoOpen          boolean  Open result in default app after generation
  autoClipboard     boolean  Copy result URL to clipboard
  autoBell          boolean  Play terminal bell on completion
  autoNotify        boolean  Send desktop notification on completion
  recentFilesCount  number   Number of recent files to show (1-500)
  imagePreview      boolean  Show image preview in terminal
  autoUpdate        boolean  Auto-update CLI when new version is available`;

  static examples = [
    { command: '<%= config.bin %> config set defaultModel kling-v3-pro', description: 'Set default model' },
    { command: '<%= config.bin %> config set downloadDir /Users/me/ai-output', description: 'Set download directory' },
    { command: '<%= config.bin %> config set autoOpen true', description: 'Auto-open results after generation' },
    { command: '<%= config.bin %> config set autoUpdate true', description: 'Enable auto-update' },
    { command: '<%= config.bin %> config set recentFilesCount 50', description: 'Show more recent files' },
  ];
  static args = {
    key: Args.string({ description: 'Config key', required: true }),
    value: Args.string({ description: 'Config value', required: true }),
  };

  async run() {
    const { args } = await this.parse(ConfigSet);
    const validKeys = getConfigKeys();
    if (!validKeys.includes(args.key)) {
      throw new UsageError(`Unknown config key: "${args.key}". Valid keys: ${validKeys.join(', ')}`);
    }
    const result = setConfigValue(args.key, args.value);
    if (!result.ok) throw new UsageError(result.reason);
    this.out.success(`${args.key} set to ${args.value}`);
  }
}

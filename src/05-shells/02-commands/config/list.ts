import { renderKeyValue } from '#infra/ui-core/components/key-value.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getUserConfig } from '#services/user-config.ts';

export default class ConfigList extends BaseCommand {
  static description = 'List all configuration values';
  static examples = [
    { command: '<%= config.bin %> config list', description: 'Show all current settings' },
    { command: '<%= config.bin %> config list --json', description: 'Output as JSON' },
  ];

  async run() {
    const config = getUserConfig();
    if (this.isJsonMode) {
      this.out.json(config);
      return;
    }
    const entries = Object.entries(config);
    if (entries.length === 0) {
      this.out.info('No configuration set. Use "gen-ai config set <key> <value>" to configure.');
      return;
    }
    const kv = renderKeyValue(
      entries.map(([k, v]) => [k, String(v)]),
      { color: this.color },
    );
    this.out.card(kv.split('\n'), { title: 'Configuration' });
  }
}

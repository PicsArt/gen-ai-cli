import { BaseCommand } from '#root/base-command.ts';
import { clearHistory } from '#services/history.ts';

export default class HistoryClear extends BaseCommand {
  static description = 'Clear all generation history';

  static examples = ['<%= config.bin %> history clear'];

  static flags = {
    ...BaseCommand.baseFlags,
  };

  async run() {
    const cleared = clearHistory();
    if (cleared) {
      this.out.success('History cleared.');
    } else {
      this.out.info('No history file found.');
    }
  }
}

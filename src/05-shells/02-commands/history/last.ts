import { BaseCommand } from '#root/base-command.ts';
import { getLastEntry } from '#services/history.ts';
import { buildEntryDetailLines } from './render-entry.ts';

export default class HistoryLast extends BaseCommand {
  static description = 'Show the most recent generation entry';

  static examples = ['<%= config.bin %> history last', '<%= config.bin %> history last --json'];

  static flags = {
    ...BaseCommand.baseFlags,
  };

  async run() {
    const entry = getLastEntry();

    if (!entry) {
      this.out.info('No generation history.');
      return;
    }

    if (this.isJsonMode) {
      this.out.json(entry);
      return;
    }

    this.out.card(buildEntryDetailLines(entry, this.color), { title: 'Last Generation' });
  }
}

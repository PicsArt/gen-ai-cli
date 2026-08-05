import { BaseCommand } from '#root/base-command.ts';
import { loadRecentFiles } from '#services/history.ts';

export default class HistoryFiles extends BaseCommand {
  static description = 'Show recently used input files';

  static examples = ['<%= config.bin %> history files', '<%= config.bin %> history files --json'];

  static flags = {
    ...BaseCommand.baseFlags,
  };

  async run() {
    const files = loadRecentFiles();

    if (files.length === 0) {
      this.out.info('No recent files.');
      return;
    }

    if (this.isJsonMode) {
      this.out.json(files);
      return;
    }

    const tableData = files.map((f) => ({
      lastUsed: f.usedAt.replace('T', ' ').slice(0, 19),
      type: f.type,
      path: f.path,
    }));

    this.out.richTable(tableData, {
      columns: [
        { key: 'lastUsed', label: 'Last Used' },
        { key: 'type', label: 'Type' },
        { key: 'path', label: 'Path' },
      ],
    });
  }
}

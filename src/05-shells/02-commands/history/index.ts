import { Flags } from '@oclif/core';
import { truncate } from '#infra/ui-core/components/string-utils.ts';
import { selectWithNav } from '#pipeline/01-wizard-runner/nav.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getRecentHistory, type HistoryEntry, loadHistory } from '#services/history.ts';
import { reconstructGenerateArgs } from '../meta/reconstruct-args.ts';
import Generate from '../operations/generate.ts';
import { buildEntryDetailLines, formatElapsed } from './render-entry.ts';

export default class HistoryList extends BaseCommand {
  static description = 'Browse recent generation history (interactive) or print it as a table';

  static examples = [
    {
      command: '<%= config.bin %> history',
      description: 'Browse with arrow keys; select an entry to view details or replay it',
    },
    { command: '<%= config.bin %> replay <id>', description: 'Re-run a specific entry by the id shown here' },
    { command: '<%= config.bin %> history -n 50 --json', description: 'Last 50 entries as JSON (includes ids)' },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    n: Flags.integer({
      char: 'n',
      description: 'Number of entries to show',
      default: 20,
      min: 1,
    }),
  };

  async run() {
    const { flags } = await this.parse(HistoryList);

    const entries = getRecentHistory(flags.n);

    if (entries.length === 0) {
      this.out.info('No generation history yet.');
      return;
    }

    if (this.isJsonMode) {
      this.out.json(entries);
      return;
    }

    // Non-interactive (piped / --no-input): keep the static table so scripts don't hang.
    if (this.noInput) {
      this.renderTable(entries);
      return;
    }

    await this.browse(entries);
  }

  /** Interactive arrow-key browser: pick an entry → show its details → repeat. */
  private async browse(entries: HistoryEntry[]): Promise<void> {
    const choices = entries.map((entry, index) => ({
      name: this.formatRow(entry),
      value: index,
    }));

    while (true) {
      const picked = await selectWithNav<number>({
        message: 'Generation history (↑↓ to browse, Enter for details):',
        choices,
        pageSize: 15,
      });

      if (picked === BACK || picked === CANCEL) return;

      const entry = entries[picked];
      this.out.card(buildEntryDetailLines(entry, this.color), { title: 'Generation Details' });

      // Offer to replay the selected entry. Replay hands off to `generate`, so
      // it ends the browse loop.
      const action = await selectWithNav<'replay' | 'back'>({
        message: 'What next?',
        choices: [
          { name: 'Replay this generation', value: 'replay' },
          { name: 'Back to list', value: 'back' },
        ],
      });

      if (action === 'replay') {
        await Generate.run(reconstructGenerateArgs(entry));
        return;
      }
      if (action === BACK || action === CANCEL) return;
    }
  }

  /** Single-line summary of an entry for the picker list. */
  private formatRow(entry: HistoryEntry): string {
    const id = this.color.dim((entry.id ?? '').padEnd(11).slice(0, 11));
    const time = entry.timestamp.replace('T', ' ').slice(0, 19);
    const model = (entry.modelName ?? entry.model).padEnd(22).slice(0, 22);
    const prompt = truncate(entry.prompt ?? '(no prompt)', 32).padEnd(32);
    const status = entry.status === 'completed' ? this.color.green('OK') : this.color.red('FAIL');
    return `${id}  ${this.color.dim(time)}  ${model}  ${prompt}  ${status}`;
  }

  private renderTable(entries: HistoryEntry[]): void {
    this.out.divider({ label: 'Generation History' });
    process.stderr.write('\n');

    const tableData = entries.map((entry) => ({
      id: entry.id ?? '-',
      time: entry.timestamp.replace('T', ' ').slice(0, 19),
      model: entry.modelName ?? entry.model,
      prompt: truncate(entry.prompt ?? '(no prompt)', 30),
      status: entry.status === 'completed' ? this.color.green('OK') : this.color.red('FAIL'),
      duration: entry.durationMs ? formatElapsed(entry.durationMs) : '-',
    }));

    this.out.richTable(tableData, {
      columns: [
        { key: 'id', label: 'Id' },
        { key: 'time', label: 'Time' },
        { key: 'model', label: 'Model' },
        { key: 'prompt', label: 'Prompt' },
        { key: 'status', label: 'Status' },
        { key: 'duration', label: 'Duration' },
      ],
    });

    if (!this.isQuiet) {
      const total = loadHistory().length;
      this.out.result(`\n${entries.length} entries (total: ${total})`);
    }
  }
}

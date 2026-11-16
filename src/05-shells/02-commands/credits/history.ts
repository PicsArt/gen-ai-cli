import { Flags } from '@oclif/core';
import type { ColorManager } from '#infra/ui-core/color.ts';
import { createSpinner } from '#infra/ui-core/progress.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getAuthenticatedFetch } from '#services/client.ts';
import { getApiUrl } from '#services/constants.ts';
import {
  CREDIT_HISTORY_MAX_PAGES,
  type CreditHistoryItem,
  type CreditHistoryItemType,
  type CreditHistoryResult,
  type CreditHistorySummary,
  fetchCreditHistory,
  summarizeCreditHistory,
} from '#services/credits-history.ts';

const ITEM_TYPES: readonly CreditHistoryItemType[] = ['deduct', 'refund', 'grant'];

const GRANT_LABELS: Record<string, string> = {
  INITIAL_FREE_CREDITS: 'Free credits',
  SUBSCRIPTION: 'Subscription',
  OTP: 'One-time purchase',
  MANUAL: 'Manual grant',
};

/** Signed, colored amount: spending is negative, grants and refunds positive. */
export function formatCreditAmount(item: CreditHistoryItem, color: ColorManager): string {
  if (item.type === 'deduct') return color.red(`-${item.creditAmount}`);
  return color.green(`+${item.creditAmount}`);
}

/** Where the credits went / came from: product name for spend, grant kind for grants. */
export function describeCreditSource(item: CreditHistoryItem): string {
  if (item.name) return item.name;
  if (item.grantType) return GRANT_LABELS[item.grantType] ?? item.grantType;
  return '';
}

/** `2026-11-10T07:43:16.911Z` → `2026-11-10 07:43` in the user's local time. */
export function formatCreditDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default class CreditsHistory extends BaseCommand {
  static summary = 'Show your credit spending history';

  static description = `Lists credit transactions newest-first: spending (deduct), refunds, and grants
(subscription, purchases, free credits), with the product that used them.`;

  static examples = [
    { command: '<%= config.bin %> credits history', description: 'Last 20 transactions' },
    { command: '<%= config.bin %> credits history -n 50 --type deduct', description: 'Last 50 spends' },
    { command: '<%= config.bin %> credits history --all --json', description: 'Full history as JSON' },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    n: Flags.integer({
      char: 'n',
      description: 'Number of transactions to show',
      default: 20,
      min: 1,
    }),
    all: Flags.boolean({
      description: 'Fetch the full history (ignores -n)',
      default: false,
    }),
    type: Flags.string({
      char: 't',
      description: 'Only show this transaction type (repeatable)',
      options: [...ITEM_TYPES],
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CreditsHistory);
    // oclif's `options` already rejects anything outside ITEM_TYPES.
    const types = flags.type as CreditHistoryItemType[] | undefined;
    const { json, quiet } = this.deps.flags;

    const { authenticatedFetch } = await getAuthenticatedFetch(this.out);
    // Silent when piped / --json / --quiet: createSpinner only draws on a TTY.
    const spinner = createSpinner('Fetching credit history…', quiet || json).start();
    let result: CreditHistoryResult;
    try {
      result = await fetchCreditHistory(authenticatedFetch, getApiUrl(), {
        limit: flags.all ? undefined : flags.n,
        types,
        onPage: (fetched) => {
          spinner.text = `Fetching credit history… ${fetched} transactions`;
        },
      });
    } finally {
      spinner.stop();
    }
    const { items, hasMore, capped } = result;
    const summary = summarizeCreditHistory(items);

    if (json) {
      this.out.json({ items, hasMore, capped, summary });
      return;
    }

    if (items.length === 0) {
      // A filtered walk can come back empty while older history still exists.
      this.out.info(types ? `No ${types.join(' / ')} transactions found.` : 'No credit history yet.');
    } else {
      this.renderTable(items, summary);
    }

    if (capped) {
      this.out.info(
        this.color.dim(`Stopped after ${CREDIT_HISTORY_MAX_PAGES} requests; older history exists but isn't shown.`),
      );
    } else if (hasMore) {
      this.out.info(this.color.dim('Older history available — use -n <count> or --all.'));
    }
  }

  private renderTable(items: CreditHistoryItem[], summary: CreditHistorySummary): void {
    this.out.richTable(
      items.map((item) => ({
        date: formatCreditDate(item.date),
        type: item.type,
        credits: formatCreditAmount(item, this.color),
        source: describeCreditSource(item),
      })),
      {
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'type', label: 'Type' },
          { key: 'credits', label: 'Credits', align: 'right' },
          { key: 'source', label: 'Source' },
        ],
      },
    );

    const parts = [`Spent ${this.color.bold(String(summary.spent))}`];
    if (summary.refunded) parts.push(`refunded ${summary.refunded}`);
    if (summary.granted) parts.push(`granted ${summary.granted}`);
    this.out.info(`${parts.join(' · ')}  ${this.color.dim(`(${items.length} transactions shown)`)}`);
  }
}

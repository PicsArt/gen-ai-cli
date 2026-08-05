import { renderKeyValue } from '#infra/ui-core/components/key-value.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getAuthenticatedFetch } from '#services/client.ts';
import { getApiUrl } from '#services/constants.ts';

export default class Credits extends BaseCommand {
  static summary = 'Show your current credit balance';

  static description = `Displays your available Picsart credits (base + addon).
Use this before generating to check if you have enough credits.`;

  static examples = [
    { command: '<%= config.bin %> credits', description: 'Show current balance' },
    { command: '<%= config.bin %> credits --json', description: 'Output as JSON' },
  ];

  async run(): Promise<void> {
    const { authenticatedFetch } = await getAuthenticatedFetch();
    const apiUrl = getApiUrl();

    const res = await authenticatedFetch(`${apiUrl}/guard/credits`);
    if (!res.ok) {
      this.out.error(`Failed to fetch credits (HTTP ${res.status})`);
      return;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const response = data.response as Record<string, unknown> | undefined;
    const credits = Number(response?.credits ?? 0);
    const addonCredits = Number(response?.addonCredits ?? 0);
    const total = credits + addonCredits;

    if (this.isJsonMode) {
      this.out.json({ credits, addonCredits, total });
      return;
    }

    const kv = renderKeyValue(
      [
        ['Total', this.color.bold(String(total))],
        ['Base', String(credits)],
        ['Addon', String(addonCredits)],
      ],
      { color: this.color },
    );

    const lines = kv.split('\n');
    lines.push('');
    lines.push(this.color.dim('Top up at https://picsart.com/pricing'));
    this.out.card(lines, { title: 'Picsart Credits' });
  }
}

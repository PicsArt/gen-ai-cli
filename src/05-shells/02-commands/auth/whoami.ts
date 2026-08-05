import { renderKeyValue } from '#infra/ui-core/components/key-value.ts';
import { BaseCommand } from '#root/base-command.ts';
import { whoami } from '#services/auth.ts';

export default class Whoami extends BaseCommand {
  static description = 'Show current authentication status';

  static examples = ['<%= config.bin %> whoami'];

  async run() {
    const creds = await whoami();
    if (!creds) {
      this.out.card(['Not logged in.', '', 'Run gen-ai login to authenticate.'], {
        title: '\u2717 Not Authenticated',
        borderColor: '#F8495A',
      });
      return;
    }

    if (this.isJsonMode) {
      this.out.json({ email: creds.email, uid: creds.uid });
      return;
    }

    const kv = renderKeyValue(
      [
        ['Email', creds.email],
        ['UID', creds.uid],
      ],
      { color: this.color },
    );

    this.out.card(kv.split('\n'), {
      title: '\u2713 Authenticated',
      borderColor: '#64ED68',
    });
  }
}

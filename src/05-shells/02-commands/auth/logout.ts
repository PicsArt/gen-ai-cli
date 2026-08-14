import { BaseCommand } from '#root/base-command.ts';
import { logout } from '#services/auth.ts';

export default class Logout extends BaseCommand {
  static description = 'Sign out and remove saved credentials';

  static examples = ['<%= config.bin %> logout'];

  async run() {
    const { envCredentialsActive } = await logout();
    this.out.success('Logged out.');
    if (envCredentialsActive) {
      this.out.warn(
        'PICSART_ACCESS_TOKEN and PICSART_USER_ID are still set — env credentials remain active. Unset them to fully sign out.',
      );
    }
  }
}

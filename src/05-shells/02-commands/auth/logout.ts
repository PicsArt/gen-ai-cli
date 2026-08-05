import { BaseCommand } from '#root/base-command.ts';
import { logout } from '#services/auth.ts';

export default class Logout extends BaseCommand {
  static description = 'Sign out and remove saved credentials';

  static examples = ['<%= config.bin %> logout'];

  async run() {
    await logout();
    this.out.success('Logged out.');
  }
}

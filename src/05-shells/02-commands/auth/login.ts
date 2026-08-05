import { BaseCommand } from '#root/base-command.ts';
import { login } from '#services/auth.ts';

export default class Login extends BaseCommand {
  static description = 'Sign in to your Picsart account';

  static examples = ['<%= config.bin %> login'];

  async run() {
    const creds = await login();
    this.out.success(`Logged in as ${creds.email}`);
    this.out.info("Run 'gen-ai models' to browse available models.");
  }
}

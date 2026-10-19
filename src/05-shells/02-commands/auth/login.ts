import { Flags } from '@oclif/core';
import { BaseCommand } from '#root/base-command.ts';
import { login } from '#services/auth.ts';
import { deviceLogin } from '#services/device-auth.ts';

export default class Login extends BaseCommand {
  static description = 'Sign in to your Picsart account';

  static examples = ['<%= config.bin %> login', '<%= config.bin %> login --device'];

  static flags = {
    ...BaseCommand.baseFlags,
    device: Flags.boolean({
      description: 'Sign in without a local browser (device code flow — for SSH, containers, headless hosts)',
      default: false,
    }),
  };

  async run() {
    const { flags } = await this.parse(Login);
    const creds = flags.device ? await deviceLogin(this.out) : await login(this.out);
    this.out.success(`Logged in as ${creds.email}`);
    this.out.info("Run 'gen-ai models' to browse available models.");
  }
}

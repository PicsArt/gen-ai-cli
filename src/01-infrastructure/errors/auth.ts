import { CliError, ExitCode } from './base.ts';

export class AuthError extends CliError {
  readonly exitCode = ExitCode.AUTH_ERROR;
  hint = "Run 'gen-ai login' to sign in.";

  get friendlyMessage(): string {
    return `Authentication failed: ${this.message}`;
  }
}

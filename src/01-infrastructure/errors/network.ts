import { CliError, ExitCode } from './base.ts';

export class NetworkError extends CliError {
  readonly exitCode = ExitCode.NETWORK_ERROR;
  hint = 'Check your internet connection. If behind a proxy, set HTTPS_PROXY.';

  get friendlyMessage(): string {
    return `Could not reach the server: ${this.message}`;
  }
}

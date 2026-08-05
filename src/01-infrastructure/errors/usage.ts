import { CliError, ExitCode } from './base.ts';

export class UsageError extends CliError {
  readonly exitCode = ExitCode.USAGE_ERROR;

  get friendlyMessage(): string {
    return this.message;
  }
}

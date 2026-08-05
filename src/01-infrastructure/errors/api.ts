import { CliError, ExitCode } from './base.ts';

export class ApiError extends CliError {
  readonly exitCode = ExitCode.API_ERROR;

  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    if (statusCode === 429) this.hint = 'Rate limited. Wait a moment and try again.';
    else if (statusCode >= 500) this.hint = 'This is a server-side issue. Try again shortly.';
  }

  get friendlyMessage(): string {
    return `API error (${this.statusCode}): ${this.message}`;
  }
}

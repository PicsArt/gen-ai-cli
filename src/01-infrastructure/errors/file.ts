import { CliError, ExitCode } from './base.ts';

export class FileError extends CliError {
  readonly exitCode = ExitCode.FILE_ERROR;

  readonly filePath: string;

  constructor(filePath: string, reason: string) {
    super(reason);
    this.filePath = filePath;
  }

  get friendlyMessage(): string {
    return `File error: ${this.filePath} — ${this.message}`;
  }
}

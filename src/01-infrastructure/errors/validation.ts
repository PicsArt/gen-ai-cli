import { CliError, ExitCode } from './base.ts';

export interface FieldError {
  field: string;
  message: string;
}

export class ValidationError extends CliError {
  readonly exitCode = ExitCode.VALIDATION_ERROR;
  readonly fieldErrors: FieldError[];

  constructor(fieldErrors: FieldError[]) {
    super('Validation failed');
    this.fieldErrors = fieldErrors;
  }

  get friendlyMessage(): string {
    if (this.fieldErrors.length === 1) {
      const { field, message } = this.fieldErrors[0];
      return `Invalid ${field}: ${message}`;
    }
    const lines = this.fieldErrors.map(({ field, message }) => `  - ${field}: ${message}`);
    return `Validation failed:\n${lines.join('\n')}`;
  }
}

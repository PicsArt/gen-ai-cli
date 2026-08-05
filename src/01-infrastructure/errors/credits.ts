import { CliError, ExitCode } from './base.ts';

export class InsufficientCreditsError extends CliError {
  readonly exitCode = ExitCode.CREDITS_ERROR;

  readonly balance: number;
  readonly required: number;

  constructor(balance: number, required: number) {
    super(`Need ${required} credits but only have ${balance}`);
    this.balance = balance;
    this.required = required;
    this.hint = 'Top up your credits at https://picsart.com/pricing';
  }

  get friendlyMessage(): string {
    return `Insufficient credits: you have ${this.balance}, but this operation requires ${this.required}.`;
  }
}

export const ExitCode = {
  OK: 0,
  GENERAL_ERROR: 1,
  USAGE_ERROR: 2,
  AUTH_ERROR: 3,
  NETWORK_ERROR: 4,
  API_ERROR: 5,
  VALIDATION_ERROR: 6,
  CREDITS_ERROR: 7,
  FILE_ERROR: 8,
  USER_CANCEL: 9,
  RENDER_ERROR: 10,
} as const;

export abstract class CliError extends Error {
  abstract readonly exitCode: number;
  abstract readonly friendlyMessage: string;
  hint?: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

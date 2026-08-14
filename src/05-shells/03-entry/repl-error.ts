/**
 * REPL error decision — what the loop does after a dispatched command throws.
 *
 * BaseCommand.catch always terminates via `this.exit()`, so every command
 * failure reaches the REPL as an oclif ExitError (`err.oclif.exit`) — the
 * original CliError never survives the boundary. The real error card was
 * already printed by BaseCommand.catch, so the REPL must not print oclif's
 * raw "EEXIT: n" wrapper on top of it. Exit code USER_CANCEL (9) is the
 * cancel sentinel (Ctrl+C / ESC inside a wizard) and arms the
 * double-Ctrl+C-to-quit timer instead.
 */
import { CliError, ExitCode } from '#infra/errors/index.ts';

export const DOUBLE_CTRL_C_MS = 1000;

export interface ReplErrorDecision {
  /** Quit the REPL loop (second cancel within the double-Ctrl+C window). */
  quit: boolean;
  /** Error text the REPL should print, if any. */
  message?: string;
  /** Updated double-Ctrl+C timestamp (unchanged for non-cancel errors). */
  lastCtrlCAt: number;
}

function getOclifExit(err: unknown): number | undefined {
  if (err instanceof Error && 'oclif' in err) {
    const exit = (err as Error & { oclif?: { exit?: number } }).oclif?.exit;
    if (typeof exit === 'number') return exit;
  }
  return undefined;
}

export function decideReplError(err: unknown, lastCtrlCAt: number, now: number): ReplErrorDecision {
  const oclifExit = getOclifExit(err);
  const isCancel = oclifExit === ExitCode.USER_CANCEL || (err instanceof CliError && err.message === 'USER_CANCEL');

  if (isCancel) {
    if (now - lastCtrlCAt < DOUBLE_CTRL_C_MS) return { quit: true, lastCtrlCAt };
    return { quit: false, lastCtrlCAt: now };
  }

  // Any other ExitError: BaseCommand.catch already rendered the real error
  // card before exiting — repeating oclif's "EEXIT: n" wrapper is pure noise.
  if (oclifExit !== undefined) return { quit: false, lastCtrlCAt };

  if (err instanceof CliError) return { quit: false, message: err.friendlyMessage ?? err.message, lastCtrlCAt };
  if (err instanceof Error) return { quit: false, message: err.message, lastCtrlCAt };
  return { quit: false, message: String(err), lastCtrlCAt };
}

/**
 * Spec for the REPL error decision helper.
 *
 * BaseCommand.catch always terminates via `this.exit()` — so every command
 * failure reaches the REPL loop as an oclif ExitError, never as the original
 * CliError. Contract:
 *   - ExitError with exit === USER_CANCEL (9) is the cancel sentinel: arms
 *     the double-Ctrl+C timer, quits on the second cancel within the window
 *   - other ExitError codes print NOTHING (BaseCommand already rendered the
 *     real error card) — no raw "EEXIT: n" noise
 *   - legacy CliError('USER_CANCEL') sentinel still arms the timer
 *   - non-oclif errors surface their message
 */
import { Errors } from '@oclif/core';
import { describe, expect, it } from 'vitest';
import { UsageError } from '#infra/errors/usage.ts';
import { DOUBLE_CTRL_C_MS, decideReplError } from './repl-error.ts';

const NOW = 1_000_000;

describe('decideReplError — cancel sentinel (double-Ctrl+C)', () => {
  it('treats oclif ExitError with exit=9 as cancel: arms the timer, no message, no quit', () => {
    const d = decideReplError(new Errors.ExitError(9), 0, NOW);
    expect(d.quit).toBe(false);
    expect(d.message).toBeUndefined();
    expect(d.lastCtrlCAt).toBe(NOW);
  });

  it('quits on a second cancel within the double-Ctrl+C window', () => {
    const first = decideReplError(new Errors.ExitError(9), 0, NOW);
    const second = decideReplError(new Errors.ExitError(9), first.lastCtrlCAt, NOW + DOUBLE_CTRL_C_MS - 1);
    expect(second.quit).toBe(true);
  });

  it('does not quit when the second cancel is outside the window', () => {
    const first = decideReplError(new Errors.ExitError(9), 0, NOW);
    const second = decideReplError(new Errors.ExitError(9), first.lastCtrlCAt, NOW + DOUBLE_CTRL_C_MS + 1);
    expect(second.quit).toBe(false);
    expect(second.lastCtrlCAt).toBe(NOW + DOUBLE_CTRL_C_MS + 1);
  });

  it('still recognizes the legacy CliError USER_CANCEL sentinel', () => {
    const d = decideReplError(new UsageError('USER_CANCEL'), 0, NOW);
    expect(d.quit).toBe(false);
    expect(d.message).toBeUndefined();
    expect(d.lastCtrlCAt).toBe(NOW);
  });
});

describe('decideReplError — non-cancel errors', () => {
  it('suppresses the message for other oclif exit codes (card already printed by BaseCommand)', () => {
    const d = decideReplError(new Errors.ExitError(1), 0, NOW);
    expect(d.quit).toBe(false);
    expect(d.message).toBeUndefined();
    expect(d.lastCtrlCAt).toBe(0); // timer untouched
  });

  it('surfaces the friendly message for a CliError that bypassed BaseCommand', () => {
    const d = decideReplError(new UsageError('bad flag'), 0, NOW);
    expect(d.message).toBe('bad flag');
    expect(d.quit).toBe(false);
  });

  it('surfaces plain Error messages', () => {
    const d = decideReplError(new Error('kaboom'), 0, NOW);
    expect(d.message).toBe('kaboom');
  });

  it('stringifies non-Error throwables', () => {
    const d = decideReplError('weird', 0, NOW);
    expect(d.message).toBe('weird');
  });
});

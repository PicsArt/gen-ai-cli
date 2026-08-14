/**
 * Spec for the credits-error helper.
 *
 * Contracts:
 *   isCreditsError(err):
 *     - true for InsufficientCreditsError instances
 *     - true for Error.message matching /402|not enough.*credit|insufficient.*credit/i
 *     - false otherwise
 *
 *   handleCreditsError(err, deps):
 *     - emits a deps.out.error message
 *     - skips the prompt when deps.flags.noInput is set
 *     - prompts the user via selectWithNav (cancel-only nav) otherwise
 *     - 'buy' selection opens the billing URL via openInDefault
 *     - 'exit' / BACK / CANCEL all return without opening
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '#infra/errors/api.ts';
import { InsufficientCreditsError } from '#infra/errors/credits.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import type { CliDeps } from '#root/deps.ts';

const selectWithNavMock = vi.hoisted(() => vi.fn());
const openInDefaultMock = vi.hoisted(() => vi.fn());

vi.mock('#pipeline/01-wizard-runner/nav.ts', () => ({ selectWithNav: selectWithNavMock }));
vi.mock('#infra/utils/open.ts', () => ({ openInDefault: openInDefaultMock }));

import { handleCreditsError, isCreditsError } from './handle-credits-error.ts';

function makeDeps(overrides: Partial<CliDeps['flags']> = {}): {
  deps: CliDeps;
  calls: { error: string[]; info: string[] };
} {
  const calls = { error: [] as string[], info: [] as string[] };
  const deps = {
    out: {
      error: (msg: string) => calls.error.push(msg),
      info: (msg: string) => calls.info.push(msg),
    },
    flags: { json: false, plain: false, quiet: false, debug: false, noInput: false, ...overrides },
  } as unknown as CliDeps;
  return { deps, calls };
}

/* ── isCreditsError ────────────────────────────────────────── */

describe('isCreditsError', () => {
  it('returns true for InsufficientCreditsError instances', () => {
    expect(isCreditsError(new InsufficientCreditsError(0, 10))).toBe(true);
  });

  it('returns true for Error with a 402 in the message', () => {
    expect(isCreditsError(new Error('request failed: 402 Payment Required'))).toBe(true);
  });

  it('returns true for "not enough credit" wording', () => {
    expect(isCreditsError(new Error('not enough credit on your account'))).toBe(true);
  });

  it('returns true for "insufficient credit" wording', () => {
    expect(isCreditsError(new Error('insufficient credits for this operation'))).toBe(true);
  });

  it('returns true for ApiError with statusCode 402 even when the message lacks "credit"', () => {
    expect(isCreditsError(new ApiError(402, 'payment required'))).toBe(true);
  });

  it('returns false for ApiError with other status codes', () => {
    expect(isCreditsError(new ApiError(500, 'server exploded'))).toBe(false);
  });

  it('returns false for unrelated errors', () => {
    expect(isCreditsError(new Error('network unreachable'))).toBe(false);
    expect(isCreditsError(undefined)).toBe(false);
    expect(isCreditsError('a string')).toBe(false);
  });
});

/* ── handleCreditsError ───────────────────────────────────── */

describe('handleCreditsError', () => {
  it('always emits an error message via deps.out.error', async () => {
    selectWithNavMock.mockReset().mockResolvedValue('exit');
    const { deps, calls } = makeDeps();
    await handleCreditsError(new Error('boom'), deps);
    expect(calls.error[0]).toMatch(/Insufficient credits/i);
  });

  it('skips the prompt when --no-input is set', async () => {
    selectWithNavMock.mockReset();
    const { deps } = makeDeps({ noInput: true });
    await handleCreditsError(new Error('x'), deps);
    expect(selectWithNavMock).not.toHaveBeenCalled();
    expect(openInDefaultMock).not.toHaveBeenCalled();
  });

  it('opens the checkout URL with analytics params when the user picks "buy"', async () => {
    selectWithNavMock.mockReset().mockResolvedValue('buy');
    openInDefaultMock.mockReset();
    const { deps } = makeDeps();
    await handleCreditsError(new Error('x'), deps);
    expect(openInDefaultMock).toHaveBeenCalledWith(
      'https://picsart.com/pricing?checkout=credit&page_origin=gen_ai_cli&action_button=gen_ai_cli_credits_wall',
    );
  });

  it('does NOT open the URL on "exit"', async () => {
    selectWithNavMock.mockReset().mockResolvedValue('exit');
    openInDefaultMock.mockReset();
    await handleCreditsError(new Error('x'), makeDeps().deps);
    expect(openInDefaultMock).not.toHaveBeenCalled();
  });

  it('treats BACK and CANCEL the same as "exit"', async () => {
    openInDefaultMock.mockReset();
    for (const sentinel of [BACK, CANCEL]) {
      selectWithNavMock.mockReset().mockResolvedValue(sentinel);
      await handleCreditsError(new Error('x'), makeDeps().deps);
    }
    expect(openInDefaultMock).not.toHaveBeenCalled();
  });
});

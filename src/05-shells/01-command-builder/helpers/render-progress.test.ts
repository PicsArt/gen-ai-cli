/**
 * Spec for the progress-rendering helper.
 *
 * Contract:
 *   createProgressHandler(spinner) returns a function that, on each
 *   `ProgressInfo` update, sets `spinner.text` to:
 *     - a percent bar + elapsed when `progress.percent` is provided
 *     - the status label + elapsed when `progress.percent` is missing
 */
import { describe, expect, it } from 'vitest';
import type { ProgressInfo } from '#root/types.ts';
import { createProgressHandler } from './render-progress.ts';

function fakeSpinner() {
  return { text: '' };
}

function strip(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('createProgressHandler — with percent', () => {
  it('renders a percent number plus an elapsed badge', () => {
    const sp = fakeSpinner();
    const handler = createProgressHandler(sp);
    handler({ status: 'in_progress', percent: 42, elapsed: 5_000 } as ProgressInfo);
    const text = strip(sp.text);
    expect(text).toContain('42%');
    expect(text).toContain('5s');
  });

  it('renders 0% and 100% cleanly', () => {
    const sp = fakeSpinner();
    const handler = createProgressHandler(sp);
    handler({ status: 'in_progress', percent: 0, elapsed: 0 } as ProgressInfo);
    expect(strip(sp.text)).toContain('0%');
    handler({ status: 'in_progress', percent: 100, elapsed: 60_000 } as ProgressInfo);
    expect(strip(sp.text)).toContain('100%');
  });
});

describe('createProgressHandler — without percent', () => {
  it('falls back to the status label + elapsed', () => {
    const sp = fakeSpinner();
    const handler = createProgressHandler(sp);
    handler({ status: 'queued', elapsed: 3_000 } as ProgressInfo);
    const text = strip(sp.text);
    expect(text).toContain('queued');
    expect(text).toContain('3s');
  });
});

describe('createProgressHandler — elapsed formatting', () => {
  it('formats seconds when under a minute', () => {
    const sp = fakeSpinner();
    createProgressHandler(sp)({ status: 'x', percent: 10, elapsed: 12_000 } as ProgressInfo);
    expect(strip(sp.text)).toMatch(/12s/);
  });

  it('formats m s when over a minute', () => {
    const sp = fakeSpinner();
    createProgressHandler(sp)({ status: 'x', percent: 10, elapsed: 125_000 } as ProgressInfo);
    expect(strip(sp.text)).toMatch(/2m 5s/);
  });

  it('formats h m when over an hour', () => {
    const sp = fakeSpinner();
    createProgressHandler(sp)({ status: 'x', percent: 10, elapsed: 3_660_000 } as ProgressInfo);
    expect(strip(sp.text)).toMatch(/1h 01m/);
  });
});

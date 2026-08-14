/**
 * Progress helpers — non-TTY noop bar and silent spinner behavior.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgressBar, createSpinner } from './progress.ts';

let originalIsTTYDesc: PropertyDescriptor | undefined;

beforeEach(() => {
  originalIsTTYDesc = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
});

afterEach(() => {
  if (originalIsTTYDesc) Object.defineProperty(process.stderr, 'isTTY', originalIsTTYDesc);
  else Reflect.deleteProperty(process.stderr, 'isTTY');
});

describe('createProgressBar — non-TTY', () => {
  it('returns a noop bar whose update/stop never write or throw', () => {
    let wrote = false;
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => {
      wrote = true;
      return true;
    }) as typeof process.stderr.write;
    try {
      const bar = createProgressBar({ label: 'Upload', total: 10 });
      bar.update(5);
      bar.update(10, 20);
      bar.stop();
    } finally {
      process.stderr.write = orig;
    }
    expect(wrote).toBe(false);
  });
});

describe('createSpinner', () => {
  function runSilently(fn: () => void): boolean {
    let wrote = false;
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => {
      wrote = true;
      return true;
    }) as typeof process.stderr.write;
    try {
      fn();
    } finally {
      process.stderr.write = orig;
    }
    return wrote;
  }

  it('writes nothing when the stream is not a TTY', () => {
    const wrote = runSilently(() => {
      const spinner = createSpinner('working');
      spinner.start();
      spinner.stop();
    });
    expect(wrote).toBe(false);
  });

  it('writes nothing in quiet mode regardless of TTY', () => {
    const wrote = runSilently(() => {
      const spinner = createSpinner('working', true);
      spinner.start();
      spinner.stop();
    });
    expect(wrote).toBe(false);
  });
});

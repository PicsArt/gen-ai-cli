/**
 * Spec for execution/parse-duration.
 *
 * Contract:
 *   parseDuration(input):
 *     - "30m" → 30 * 60_000
 *     - "1h"  → 60 * 60_000
 *     - "90s" → 90_000
 *     - "45"  → 45 * 60_000 (bare integer = minutes)
 *     - whitespace tolerated
 *     - throws UsageError on garbage / negative / zero
 */
import { describe, expect, it } from 'vitest';
import { UsageError } from '#infra/errors/usage.ts';
import { parseDuration } from './parse-duration.ts';

describe('parseDuration', () => {
  it('parses suffixed seconds', () => {
    expect(parseDuration('90s')).toBe(90_000);
  });

  it('parses suffixed minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60_000);
  });

  it('parses suffixed hours', () => {
    expect(parseDuration('1h')).toBe(60 * 60_000);
    expect(parseDuration('2h')).toBe(120 * 60_000);
  });

  it('treats a bare integer as minutes', () => {
    expect(parseDuration('45')).toBe(45 * 60_000);
  });

  it('tolerates whitespace', () => {
    expect(parseDuration(' 30m ')).toBe(30 * 60_000);
  });

  it('rejects garbage', () => {
    expect(() => parseDuration('soon')).toThrow(UsageError);
    expect(() => parseDuration('30x')).toThrow(UsageError);
    expect(() => parseDuration('')).toThrow(UsageError);
  });

  it('rejects zero and negative', () => {
    expect(() => parseDuration('0m')).toThrow(UsageError);
    expect(() => parseDuration('-5m')).toThrow(UsageError);
  });
});

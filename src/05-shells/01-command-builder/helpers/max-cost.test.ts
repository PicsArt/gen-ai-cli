/**
 * Spec for the --max-cost estimator (pure worst-case credit calc).
 */
import type { CreditRange } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { estimateMaxCredits } from './max-cost.ts';

const flat = (min: number, max: number): CreditRange => ({ min, max }) as CreditRange;
const perSecond = (min: number, max: number): CreditRange => ({ min, max, unit: 'second' }) as CreditRange;

describe('estimateMaxCredits', () => {
  it('returns null when the range is unknown', () => {
    expect(estimateMaxCredits(null, {})).toBeNull();
  });

  it('uses the max of the range (worst case)', () => {
    expect(estimateMaxCredits(flat(8, 20), {})).toBe(20);
  });

  it('scales per-second pricing by duration', () => {
    expect(estimateMaxCredits(perSecond(5, 8), { duration: 4 })).toBe(32);
  });

  it('ignores duration for non-time units', () => {
    expect(estimateMaxCredits(flat(10, 10), { duration: 9 })).toBe(10);
  });

  it('multiplies by output count', () => {
    expect(estimateMaxCredits(flat(6, 6), { count: 3 })).toBe(18);
    expect(estimateMaxCredits(perSecond(2, 5), { duration: 4, count: 2 })).toBe(40);
  });

  it('rounds up to whole credits', () => {
    expect(estimateMaxCredits(flat(1, 2.4), {})).toBe(3);
  });
});

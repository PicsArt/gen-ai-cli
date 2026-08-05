/**
 * Spec for the generic wizard runner (`runWizard`).
 *
 * Contract:
 *   runWizard(steps):
 *     - runs steps in order, accumulating { [step.id]: value }
 *     - BACK rewinds to the last completed step
 *     - BACK at the first step cancels (returns null)
 *     - CANCEL returns null immediately
 *     - SKIP advances without storing a value
 *     - resuming a step clears any previous answer
 */
import { describe, expect, it, vi } from 'vitest';
import { BACK, CANCEL, runWizard, SKIP, type WizardStep } from './wizard-state.ts';

function step<T>(id: string, fn: () => Promise<T | symbol>): WizardStep<T> {
  return { id, run: fn as () => Promise<T | typeof BACK | typeof CANCEL | typeof SKIP> };
}

describe('runWizard — happy path', () => {
  it('collects results by step id in order', async () => {
    const a = vi.fn().mockResolvedValue('A');
    const b = vi.fn().mockResolvedValue('B');
    const result = await runWizard([step('a', a), step('b', b)]);
    expect(result).toEqual({ a: 'A', b: 'B' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('runWizard — CANCEL', () => {
  it('returns null when a step returns CANCEL', async () => {
    const a = vi.fn().mockResolvedValue('A');
    const b = vi.fn().mockResolvedValue(CANCEL);
    const c = vi.fn().mockResolvedValue('C');
    const result = await runWizard([step('a', a), step('b', b), step('c', c)]);
    expect(result).toBeNull();
    expect(c).not.toHaveBeenCalled();
  });
});

describe('runWizard — BACK', () => {
  it('rewinds to the previous completed step and re-runs it', async () => {
    let bCalls = 0;
    const a = vi.fn().mockResolvedValue('A');
    const b = vi.fn().mockImplementation(async () => (bCalls++ === 0 ? BACK : 'B'));
    const c = vi.fn().mockResolvedValue('C');
    const result = await runWizard([step('a', a), step('b', b), step('c', c)]);
    expect(result).toEqual({ a: 'A', b: 'B', c: 'C' });
    // a runs twice (initial + after going back), b twice (BACK + retry), c once
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it('BACK at the first step cancels the wizard', async () => {
    const a = vi.fn().mockResolvedValue(BACK);
    const result = await runWizard([step('a', a)]);
    expect(result).toBeNull();
  });

  it('clears the prior value when re-running a step', async () => {
    const a = vi.fn().mockResolvedValue('A');
    const b = vi.fn().mockResolvedValueOnce('B-first').mockResolvedValueOnce('B-final');
    const c = vi.fn().mockResolvedValueOnce(BACK).mockResolvedValueOnce('C');
    const result = await runWizard([step('a', a), step('b', b), step('c', c)]);
    expect(b).toHaveBeenCalledTimes(2);
    expect(result?.b).toBe('B-final');
    expect(result?.c).toBe('C');
  });
});

describe('runWizard — SKIP', () => {
  it('advances past the step without storing a value', async () => {
    const a = vi.fn().mockResolvedValue('A');
    const b = vi.fn().mockResolvedValue(SKIP);
    const c = vi.fn().mockResolvedValue('C');
    const result = await runWizard([step('a', a), step('b', b), step('c', c)]);
    expect(result).toEqual({ a: 'A', c: 'C' });
    expect(result?.b).toBeUndefined();
  });
});

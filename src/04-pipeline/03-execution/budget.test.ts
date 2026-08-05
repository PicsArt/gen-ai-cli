/**
 * Spec for execution/budget.
 *
 * Contract:
 *   computePollingBudget(model, intervalMs, overrideMs?):
 *     - overrideMs wins if defined and > 0 (user-supplied --poll-timeout)
 *     - else video / audio models: 30-minute total budget
 *     - else 10-minute total budget (SDK default parity)
 *     - returns `maxAttempts` rounded up so totalMs is fully covered
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { computePollingBudget } from './budget.ts';

function model(mode: ModelDefinition['mode']): ModelDefinition {
  return { id: 'x', name: 'x', mode } as ModelDefinition;
}

describe('computePollingBudget', () => {
  it('gives video models a 30-minute budget by default', () => {
    const { maxAttempts, totalMs } = computePollingBudget(model('video'), 3000);
    expect(totalMs).toBe(30 * 60 * 1000);
    expect(maxAttempts).toBe(600); // 1_800_000 / 3000
  });

  it('gives audio models a 30-minute budget by default', () => {
    const { maxAttempts } = computePollingBudget(model('audio'), 3000);
    expect(maxAttempts).toBe(600);
  });

  it('gives image models a 10-minute budget by default', () => {
    const { maxAttempts, totalMs } = computePollingBudget(model('image'), 3000);
    expect(totalMs).toBe(10 * 60 * 1000);
    expect(maxAttempts).toBe(200); // 600_000 / 3000
  });

  it('rounds maxAttempts up so the full budget is covered', () => {
    // 10 min @ 7000ms interval = 600_000 / 7000 = 85.7… → 86 attempts
    const { maxAttempts } = computePollingBudget(model('image'), 7000);
    expect(maxAttempts).toBe(86);
  });

  it('falls back to default budget when mode is undefined', () => {
    const m = { id: 'x', name: 'x' } as ModelDefinition;
    const { totalMs } = computePollingBudget(m, 3000);
    expect(totalMs).toBe(10 * 60 * 1000);
  });

  it('honors a positive overrideMs regardless of mode', () => {
    const { totalMs, maxAttempts } = computePollingBudget(model('image'), 3000, 45 * 60 * 1000);
    expect(totalMs).toBe(45 * 60 * 1000);
    expect(maxAttempts).toBe(900);
  });

  it('ignores zero or negative overrideMs and falls back to defaults', () => {
    const { totalMs } = computePollingBudget(model('video'), 3000, 0);
    expect(totalMs).toBe(30 * 60 * 1000);
    const { totalMs: t2 } = computePollingBudget(model('video'), 3000, -1);
    expect(t2).toBe(30 * 60 * 1000);
  });
});

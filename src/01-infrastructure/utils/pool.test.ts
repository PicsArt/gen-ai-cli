/**
 * Concurrency pool + id-dedup helper.
 */
import { describe, expect, it } from 'vitest';
import { deduplicateIds, runPool } from './pool.ts';

describe('deduplicateIds', () => {
  it('is a no-op when ids are unique', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    deduplicateIds(items);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('appends -1, -2, ... on collisions', () => {
    const items = [{ id: 'a' }, { id: 'a' }, { id: 'a' }, { id: 'b' }];
    deduplicateIds(items);
    expect(items.map((i) => i.id)).toEqual(['a', 'a-1', 'a-2', 'b']);
  });

  it('continues numbering when -1 is itself taken', () => {
    const items = [{ id: 'x' }, { id: 'x-1' }, { id: 'x' }];
    deduplicateIds(items);
    expect(items.map((i) => i.id)).toEqual(['x', 'x-1', 'x-2']);
  });
});

describe('runPool', () => {
  it('processes every item exactly once', async () => {
    const items = [1, 2, 3, 4, 5];
    const seen: number[] = [];
    await runPool(items, 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = [1, 2, 3, 4, 5, 6];
    await runPool(items, 2, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBe(2);
  });

  it('rethrows a single failure', async () => {
    await expect(
      runPool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('wraps multiple failures in AggregateError', async () => {
    await expect(
      runPool([1, 2, 3], 3, async (n) => {
        if (n !== 999) throw new Error(`fail-${n}`);
      }),
    ).rejects.toBeInstanceOf(AggregateError);
  });

  it('rejects invalid concurrency', async () => {
    const noop = async (): Promise<void> => undefined;
    await expect(runPool([1], 0, noop)).rejects.toThrow(/concurrency/i);
    await expect(runPool([1], -1, noop)).rejects.toThrow(/concurrency/i);
    await expect(runPool([1], 1.5, noop)).rejects.toThrow(/concurrency/i);
  });
});

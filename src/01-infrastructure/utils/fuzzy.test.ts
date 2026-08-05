/**
 * Fuzzy filter — score + filter helpers used by interactive pickers.
 * Migrated from `__tests__/unit/fuzzy.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy.ts';

describe('fuzzyScore', () => {
  it('exact substring gets high score', () => {
    expect(fuzzyScore('kling', 'kling-v3-pro')).toBeGreaterThan(100);
  });

  it('fuzzy partial matches get a positive score', () => {
    expect(fuzzyScore('kl3p', 'kling-v3-pro')).toBeGreaterThan(0);
  });

  it('returns 0 for a non-matching query', () => {
    expect(fuzzyScore('xyz123', 'kling-v3-pro')).toBe(0);
  });

  it('word-boundary or interior matches at least one positive score', () => {
    const boundary = fuzzyScore('k3p', 'kling-v3-pro');
    const interior = fuzzyScore('l30', 'kling-v3-pro');
    expect(boundary > 0 || interior > 0).toBe(true);
  });
});

describe('fuzzyFilter', () => {
  const items = [
    { id: 'veo-3.1', name: 'Veo 3.1' },
    { id: 'kling-v3-pro', name: 'Kling 3.0 Pro' },
    { id: 'kling-v3-standard', name: 'Kling 3.0 Standard' },
    { id: 'flux-schnell', name: 'Flux Schnell' },
  ];

  it('returns only matching items, sorted', () => {
    const results = fuzzyFilter(items, 'kling', (item) => `${item.name} ${item.id}`);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.id.includes('kling'))).toBe(true);
  });

  it('returns an empty array for a query with no match', () => {
    const results = fuzzyFilter(items, 'zzzzz', (item) => item.name);
    expect(results).toEqual([]);
  });

  it('returns every item for an empty query', () => {
    const flat = [{ id: 'a' }, { id: 'b' }];
    const results = fuzzyFilter(flat, '', (item) => item.id);
    expect(results.length).toBe(2);
  });
});

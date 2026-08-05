/**
 * Spec for the compare command's pure helpers (model parsing + resolution).
 * The run path itself is auth-bound and exercised via real CLI smoke.
 */
import { ALL_MODELS } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { UsageError } from '#infra/errors/usage.ts';
import { parseCompareModels, resolveCompareModels } from './compare.ts';

describe('parseCompareModels', () => {
  it('splits comma-separated values', () => {
    expect(parseCompareModels(['a,b,c'])).toEqual(['a', 'b', 'c']);
  });

  it('flattens repeated -m flags', () => {
    expect(parseCompareModels(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('mixes comma + repeat, trims, and de-dupes', () => {
    expect(parseCompareModels([' a , b ', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for undefined / empty', () => {
    expect(parseCompareModels(undefined)).toEqual([]);
    expect(parseCompareModels([''])).toEqual([]);
  });
});

describe('resolveCompareModels', () => {
  it('resolves real model ids to definitions', () => {
    const realId = ALL_MODELS.find((m) => !m.disabled)!.id;
    const resolved = resolveCompareModels([realId]);
    expect(resolved[0].id).toBe(realId);
  });

  it('throws a UsageError on the first unknown id', () => {
    const realId = ALL_MODELS.find((m) => !m.disabled)!.id;
    expect(() => resolveCompareModels([realId, 'totally-fake-zzz'])).toThrow(UsageError);
  });
});

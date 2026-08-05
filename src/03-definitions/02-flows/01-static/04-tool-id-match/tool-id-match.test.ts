/**
 * tool-id-match — verifies the flattener handles all three ToolIdMapping
 * shapes and the regex wrapper finds matches in deeply nested trees.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { flattenToolIds, hasToolIdMatching } from './tool-id-match.ts';

type ToolIdMapping = NonNullable<ModelDefinition['toolId']>;

function mockModel(toolId: ToolIdMapping | undefined): ModelDefinition {
  return {
    id: 'mock',
    name: 'Mock',
    inputType: 'i2i',
    mode: 'image',
    paramConfig: {},
    provider: 'picsart' as ModelDefinition['provider'],
    workflow: 'mock',
    providerName: 'Mock',
    providerColor: '#000',
    providerLabel: 'M',
    description: '',
    features: [],
    toolId,
  } as ModelDefinition;
}

describe('flattenToolIds', () => {
  it('returns [] for undefined', () => {
    expect(flattenToolIds(undefined)).toEqual([]);
  });

  it('returns [str] for a flat string', () => {
    expect(flattenToolIds('image-to-image.picsart-sod')).toEqual(['image-to-image.picsart-sod']);
  });

  it('walks `by/on/off` splits', () => {
    expect(flattenToolIds({ by: 'audio', on: 'gen.on', off: 'gen.off' })).toEqual(['gen.on', 'gen.off']);
  });

  it('walks `by/map` mappings', () => {
    expect(flattenToolIds({ by: 'resolution', map: { '480p': 'r.480', '1080p': 'r.1080' } })).toEqual([
      'r.480',
      'r.1080',
    ]);
  });

  it('walks nested mappings recursively', () => {
    const t: ToolIdMapping = {
      by: 'resolution',
      map: {
        '480p': { by: 'audio', on: 'a-480', off: 'b-480' },
        '1080p': 'c-1080',
      },
    };
    expect([...flattenToolIds(t)].sort()).toEqual(['a-480', 'b-480', 'c-1080']);
  });
});

describe('hasToolIdMatching', () => {
  it('matches a regex against any leaf', () => {
    const m = mockModel({ by: 'audio', on: 'image-to-image.picsart-sod', off: 'fallback' });
    expect(hasToolIdMatching(m, /picsart-sod/)).toBe(true);
  });

  it('returns false when no leaf matches', () => {
    const m = mockModel('image-to-image.picsart-enhance');
    expect(hasToolIdMatching(m, /sod/)).toBe(false);
  });

  it('returns false for a model with no toolId', () => {
    const m = mockModel(undefined);
    expect(hasToolIdMatching(m, /anything/)).toBe(false);
  });
});

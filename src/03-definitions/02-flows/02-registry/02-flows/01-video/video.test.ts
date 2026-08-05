/**
 * `video` flow spec — verifies shape + the model filter accepts t2v
 * and rejects everything else.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { VIDEO_FLOW } from './video.ts';

function mockModel(overrides: Partial<ModelDefinition>): ModelDefinition {
  return {
    id: 'mock',
    name: 'Mock',
    inputType: 't2v',
    mode: 'video',
    disabled: false,
    paramConfig: {},
    provider: 'picsart' as ModelDefinition['provider'],
    workflow: 'mock',
    providerName: 'Mock',
    providerColor: '#000',
    providerLabel: 'M',
    description: '',
    features: [],
    ...overrides,
  } as ModelDefinition;
}

describe('VIDEO_FLOW — spec shape', () => {
  it('has the canonical id and description', () => {
    expect(VIDEO_FLOW.id).toBe('video');
    expect(VIDEO_FLOW.description).toMatch(/video/i);
  });

  it('declares the standard static groups', () => {
    expect(VIDEO_FLOW.staticFlagGroups).toEqual(['universal', 'output', 'model', 'prompt-input', 'directory-input']);
    expect(VIDEO_FLOW.staticStepGroups).toEqual(['output', 'confirm']);
  });

  it('requires a prompt as user input', () => {
    expect(VIDEO_FLOW.requiredInputs).toEqual(['prompt']);
  });

  it('ships at least one example invocation', () => {
    expect(VIDEO_FLOW.examples?.length).toBeGreaterThan(0);
  });
});

describe('VIDEO_FLOW — modelFilter', () => {
  it('accepts t2v models', () => {
    expect(VIDEO_FLOW.modelFilter(mockModel({ inputType: 't2v' }))).toBe(true);
  });

  it('rejects every non-t2v inputType', () => {
    const otherInputTypes: ModelDefinition['inputType'][] = [
      'i2v',
      'v2v',
      'a2v',
      't2i',
      'i2i',
      't2a',
      'v2a',
      'tts',
      'sts',
      'sfx',
      'music',
    ];
    for (const inputType of otherInputTypes) {
      expect(VIDEO_FLOW.modelFilter(mockModel({ inputType }))).toBe(false);
    }
  });

  it('rejects disabled t2v models', () => {
    expect(VIDEO_FLOW.modelFilter(mockModel({ inputType: 't2v', disabled: true }))).toBe(false);
  });

  it('accepts t2v models when `disabled` is undefined (treats as enabled)', () => {
    expect(VIDEO_FLOW.modelFilter(mockModel({ inputType: 't2v', disabled: undefined }))).toBe(true);
  });
});

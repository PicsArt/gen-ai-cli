/**
 * Spec for the universal `generate` flow.
 *
 * The registry-level tests (`_flows.test.ts`) already cover the standard
 * shape contract. This file pins down the universal-flow specifics:
 *
 *   - modelFilter accepts every InputType (no narrowing).
 *   - modelFilter still rejects disabled models.
 *   - requiredInputs is empty by design (model-driven, not flow-driven).
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { GENERATE_FLOW } from './generate.ts';

const ALL_INPUT_TYPES: ModelDefinition['inputType'][] = [
  't2v',
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

function mockModel(overrides: Partial<ModelDefinition>): ModelDefinition {
  return {
    id: 'mock',
    name: 'Mock',
    inputType: 't2i',
    mode: 'image',
    disabled: false,
    paramConfig: {},
    toolId: 'image-gen.mock',
    ...overrides,
  } as ModelDefinition;
}

describe('GENERATE_FLOW — universal modelFilter', () => {
  it('accepts every InputType', () => {
    for (const t of ALL_INPUT_TYPES) {
      expect(GENERATE_FLOW.modelFilter(mockModel({ inputType: t }))).toBe(true);
    }
  });

  it('rejects disabled models regardless of InputType', () => {
    for (const t of ALL_INPUT_TYPES) {
      expect(GENERATE_FLOW.modelFilter(mockModel({ inputType: t, disabled: true }))).toBe(false);
    }
  });

  it('is agnostic to toolId — accepts arbitrary toolId values', () => {
    expect(GENERATE_FLOW.modelFilter(mockModel({ toolId: 'something.unknown' }))).toBe(true);
  });
});

describe('GENERATE_FLOW — required inputs', () => {
  it('declares no required inputs (model paramConfig is the source of truth)', () => {
    expect(GENERATE_FLOW.requiredInputs).toEqual([]);
  });
});

describe('GENERATE_FLOW — registry metadata', () => {
  it('uses the `generate` id', () => {
    expect(GENERATE_FLOW.id).toBe('generate');
  });

  it('declares the standard static flag and step groups', () => {
    expect(GENERATE_FLOW.staticFlagGroups).toEqual(['universal', 'output', 'model', 'prompt-input', 'directory-input']);
    expect(GENERATE_FLOW.staticStepGroups).toEqual(['output', 'confirm']);
  });

  it('ships at least one example for `gen-ai generate --help`', () => {
    expect(GENERATE_FLOW.examples?.length).toBeGreaterThan(0);
  });
});

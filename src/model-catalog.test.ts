import { findModel } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { FLOWS, modelAvailable } from '#flows';
import { getModelsForOperation } from './04-pipeline/02-resolve/types.ts';

describe('SDK 6 production catalog', () => {
  it.each([
    'flux-3-image',
    'gpt-image-2.5-flare',
    'ltx-v2.5-pro',
    'eleven-v4',
    'gpt-6-astra',
  ])('exposes %s through the universal generation picker', (id) => {
    const flow = FLOWS.generate;
    expect(getModelsForOperation(flow).some((model) => model.id === id)).toBe(true);
  });

  it.each([
    'kling-elements',
    'typesafe-evaluate',
    'gpt-image-1',
  ])('keeps preview, JSON utility, and retired models out of generation: %s', (id) => {
    const model = findModel(id);
    expect(model).toBeDefined();
    expect(modelAvailable(model!)).toBe(false);
    expect(FLOWS.generate.modelFilter(model!)).toBe(false);
  });
});

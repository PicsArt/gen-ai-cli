/**
 * Spec for the params step.
 *
 * Contract:
 *   runParamsStep(deps, model, flags, previousParams?):
 *     - normal mode: defaults + flags merged, then overlaid with wizard answers
 *     - edit mode (previousParams set): defaults + flags + previous, then overlaid with new answers
 *     - BACK / CANCEL from promptForParams are propagated
 *     - kebab-case flag keys are remapped to camelCase via buildParamsFromFlags
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { CliDeps } from '#root/deps.ts';
import { BACK, CANCEL } from '../wizard-state.ts';

const promptForParamsMock = vi.hoisted(() => vi.fn());
const buildParamsFromFlagsMock = vi.hoisted(() => vi.fn());
const ModelMock = vi.hoisted(() => vi.fn(() => ({ params: () => ({ getDefaults: () => ({}) }) })));

vi.mock('#pipeline/01-wizard-runner/prompts/prompt-params.ts', () => ({
  promptForParams: promptForParamsMock,
}));
vi.mock('#pipeline/02-resolve/types.ts', () => ({
  buildParamsFromFlags: buildParamsFromFlagsMock,
}));
vi.mock('@picsart/ai-sdk', () => ({ Model: ModelMock }));

import { runParamsStep } from './params-step.ts';

const model: ModelDefinition = { id: 'm-1' } as ModelDefinition;
const deps = {} as CliDeps;

describe('runParamsStep — normal mode', () => {
  it('merges defaults, flags, and wizard answers in that precedence', async () => {
    ModelMock.mockReset().mockImplementation(() => ({
      params: () => ({ getDefaults: () => ({ a: 1, b: 2 }) }),
    }));
    buildParamsFromFlagsMock.mockReset().mockReturnValue({ b: 20 });
    promptForParamsMock.mockReset().mockResolvedValue({ c: 30 });

    const out = await runParamsStep(deps, model, {
      /* flags */
    });
    expect(out).toEqual({ a: 1, b: 20, c: 30 });
  });

  it('returns BACK when promptForParams returns BACK', async () => {
    ModelMock.mockReset().mockImplementation(() => ({ params: () => ({ getDefaults: () => ({}) }) }));
    buildParamsFromFlagsMock.mockReset().mockReturnValue({});
    promptForParamsMock.mockReset().mockResolvedValue(BACK);
    expect(await runParamsStep(deps, model, {})).toBe(BACK);
  });

  it('returns CANCEL when promptForParams returns CANCEL', async () => {
    ModelMock.mockReset().mockImplementation(() => ({ params: () => ({ getDefaults: () => ({}) }) }));
    buildParamsFromFlagsMock.mockReset().mockReturnValue({});
    promptForParamsMock.mockReset().mockResolvedValue(CANCEL);
    expect(await runParamsStep(deps, model, {})).toBe(CANCEL);
  });

  it('tolerates Model() lookup failures and falls back to empty defaults', async () => {
    ModelMock.mockReset().mockImplementation(() => {
      throw new Error('no such model');
    });
    buildParamsFromFlagsMock.mockReset().mockReturnValue({ x: 1 });
    promptForParamsMock.mockReset().mockResolvedValue({ y: 2 });
    const out = await runParamsStep(deps, model, {});
    expect(out).toEqual({ x: 1, y: 2 });
  });
});

describe('runParamsStep — edit mode', () => {
  it('overlays previousParams between flags and wizard answers', async () => {
    ModelMock.mockReset().mockImplementation(() => ({
      params: () => ({ getDefaults: () => ({ a: 1 }) }),
    }));
    buildParamsFromFlagsMock.mockReset().mockReturnValue({ b: 2 });
    promptForParamsMock.mockReset().mockResolvedValue({ d: 4 });

    const out = await runParamsStep(deps, model, {}, { c: 3, b: 99 });
    expect(out).toEqual({ a: 1, b: 99, c: 3, d: 4 });
  });

  // Regression: edit mode used to re-ask every param with the model's
  // DESCRIPTOR defaults — a user who set duration=10 and re-entered edit
  // to change one field got everything else silently reset. The wizard
  // must receive the previous values so it can show them as defaults.
  it('passes previousParams to promptForParams as the wizard defaults', async () => {
    ModelMock.mockReset().mockImplementation(() => ({ params: () => ({ getDefaults: () => ({}) }) }));
    buildParamsFromFlagsMock.mockReset().mockReturnValue({});
    promptForParamsMock.mockReset().mockResolvedValue({});

    await runParamsStep(deps, model, {}, { duration: 10, aspectRatio: '9:16' });

    expect(promptForParamsMock).toHaveBeenCalledWith(model, expect.anything(), { duration: 10, aspectRatio: '9:16' });
  });
});

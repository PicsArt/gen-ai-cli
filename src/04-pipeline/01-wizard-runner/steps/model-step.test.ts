/**
 * Spec for the model step.
 *
 * Contract:
 *   runModelStep(deps, flow, modelFlag?):
 *     - if modelFlag resolves through `resolveModelFromFlag`, returns it directly
 *     - if modelFlag is set but does not resolve, warns and falls back to search
 *     - otherwise opens an interactive fuzzy search via `searchWithNav`
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { FlowSpec } from '#flows';
import type { CliDeps } from '#root/deps.ts';

const searchWithNavMock = vi.hoisted(() => vi.fn());
const resolveModelFromFlagMock = vi.hoisted(() => vi.fn());
const getModelsForOperationMock = vi.hoisted(() => vi.fn());

vi.mock('../nav.ts', () => ({ searchWithNav: searchWithNavMock }));
vi.mock('#pipeline/02-resolve/types.ts', () => ({
  resolveModelFromFlag: resolveModelFromFlagMock,
  getModelsForOperation: getModelsForOperationMock,
}));
vi.mock('#infra/utils/badge-priority.ts', () => ({ badgePriority: () => 0 }));
vi.mock('#infra/utils/fuzzy.ts', () => ({ fuzzyFilter: <T>(arr: T[]) => arr }));
vi.mock('#infra/ui-core/components/badge.ts', () => ({ renderPresetBadge: () => '' }));

import { runModelStep } from './model-step.ts';

const model: ModelDefinition = { id: 'm-1', name: 'Model 1', inputType: 't2i' } as unknown as ModelDefinition;
const flow: FlowSpec = {
  id: 'f',
  description: '',
  staticFlagGroups: [],
  staticStepGroups: [],
  modelFilter: () => true,
  requiredInputs: [],
} as FlowSpec;

function makeDeps(): CliDeps {
  return {
    color: {},
    out: { warn: vi.fn() },
    flags: {},
  } as unknown as CliDeps;
}

describe('runModelStep — flag fast path', () => {
  it('returns the resolved model directly when --model is valid', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue(model);
    const out = await runModelStep(makeDeps(), flow, 'm-1');
    expect(out).toBe(model);
    expect(searchWithNavMock).not.toHaveBeenCalled();
  });

  it('warns and falls back to search when --model does not resolve', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue(undefined);
    getModelsForOperationMock.mockReset().mockReturnValue([model]);
    searchWithNavMock.mockReset().mockResolvedValue(model);
    const deps = makeDeps();
    await runModelStep(deps, flow, 'unknown-model');
    expect(deps.out.warn).toHaveBeenCalled();
    expect(searchWithNavMock).toHaveBeenCalled();
  });
});

describe('runModelStep — interactive search', () => {
  it('opens search when --model is omitted and returns the selection', async () => {
    getModelsForOperationMock.mockReset().mockReturnValue([model]);
    searchWithNavMock.mockReset().mockResolvedValue(model);
    const out = await runModelStep(makeDeps(), flow);
    expect(out).toBe(model);
    expect(searchWithNavMock).toHaveBeenCalledOnce();
  });
});

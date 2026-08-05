/**
 * Spec for execution/sync.
 *
 * Contract:
 *   executeSyncModel(ctx):
 *     - emits onProgress({status:'generating', elapsed:0}) before generate
 *     - returns { status:'cancelled' } when signal is already aborted (no generate)
 *     - calls ai.generate(model.id, params) and maps result → ExecutionResult
 *     - threads result.url and result.results into ExecutionResult
 *     - durationMs is non-negative
 */
import type { GenerateResult, GenerationContext, ModelDefinition, TypedModelId } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import { executeSyncModel } from './sync.ts';

function model(): ModelDefinition {
  return { id: 'flux-pro', name: 'Flux Pro', mode: 'image' } as ModelDefinition;
}

const params: GenerationContext = { prompt: 'a sunset' } as GenerationContext;

function ai(result: GenerateResult) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    generate: vi.fn(async (_id: TypedModelId, _ctx: GenerationContext) => result),
  };
}

describe('executeSyncModel — generation flow', () => {
  it('calls ai.generate with model.id + params', async () => {
    const client = ai({ url: 'https://x.png', results: [{ url: 'https://x.png' }] } as unknown as GenerateResult);
    await executeSyncModel({ ai: client, model: model(), params });
    expect(client.generate).toHaveBeenCalledWith('flux-pro', params);
  });

  it('returns completed ExecutionResult with url + mapped results', async () => {
    const client = ai({
      url: 'https://x/a.png',
      results: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }],
    } as unknown as GenerateResult);
    const out = await executeSyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('completed');
    expect(out.url).toBe('https://x/a.png');
    expect(out.results.map((r) => r.url)).toEqual(['https://x/a.png', 'https://x/b.png']);
    expect(out.results.every((r) => r.type === 'image')).toBe(true);
  });

  it('records a non-negative durationMs', async () => {
    const client = ai({ url: 'x', results: [] } as unknown as GenerateResult);
    const out = await executeSyncModel({ ai: client, model: model(), params });
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('executeSyncModel — onProgress', () => {
  it('emits onProgress({status:"generating"}) before generating', async () => {
    const onProgress = vi.fn();
    const client = ai({ url: 'x', results: [] } as unknown as GenerateResult);
    await executeSyncModel({ ai: client, model: model(), params, onProgress });
    expect(onProgress).toHaveBeenCalledWith({ status: 'generating', elapsed: 0 });
  });
});

describe('executeSyncModel — cancellation', () => {
  it('short-circuits when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = ai({ url: 'never', results: [] } as unknown as GenerateResult);
    const out = await executeSyncModel({
      ai: client,
      model: model(),
      params,
      signal: controller.signal,
    });
    expect(out.status).toBe('cancelled');
    expect(out.results).toEqual([]);
    expect(client.generate).not.toHaveBeenCalled();
  });
});

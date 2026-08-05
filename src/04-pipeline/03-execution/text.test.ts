/**
 * Spec for execution/text.
 *
 * Contract:
 *   executeTextModel(ctx):
 *     - emits onProgress({status:'analyzing', elapsed:0}) before generateText
 *     - returns { status:'cancelled' } when signal is already aborted (no call)
 *     - calls ai.generateText(model.id, params, { signal }) and maps text → ExecutionResult
 *     - sets result.text and leaves results[] empty (no media URL)
 *     - durationMs is non-negative
 */
import type { GenerateTextResult, GenerationContext, ModelDefinition, TextModelId } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import { executeTextModel } from './text.ts';

function model(): ModelDefinition {
  return { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', mode: 'text' } as ModelDefinition;
}

const params: GenerationContext = { prompt: 'describe', imageUrls: ['https://x/a.jpg'] } as GenerationContext;

function ai(result: GenerateTextResult) {
  return {
    generateText: vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_id: TextModelId, _ctx: GenerationContext, _opts?: { signal?: AbortSignal }) => result,
    ),
  };
}

describe('executeTextModel — analysis flow', () => {
  it('calls ai.generateText with model.id, params, and the signal', async () => {
    const controller = new AbortController();
    const client = ai({ text: 'a cat' } as unknown as GenerateTextResult);
    await executeTextModel({ ai: client, model: model(), params, signal: controller.signal });
    expect(client.generateText).toHaveBeenCalledWith('claude-sonnet-4-6', params, { signal: controller.signal });
  });

  it('returns completed ExecutionResult with text and empty results[]', async () => {
    const client = ai({ text: 'A ginger cat on a sofa.' } as unknown as GenerateTextResult);
    const out = await executeTextModel({ ai: client, model: model(), params });
    expect(out.status).toBe('completed');
    expect(out.text).toBe('A ginger cat on a sofa.');
    expect(out.results).toEqual([]);
    expect(out.url).toBeUndefined();
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('executeTextModel — onProgress', () => {
  it('emits onProgress({status:"analyzing"}) before generating', async () => {
    const onProgress = vi.fn();
    const client = ai({ text: 'x' } as unknown as GenerateTextResult);
    await executeTextModel({ ai: client, model: model(), params, onProgress });
    expect(onProgress).toHaveBeenCalledWith({ status: 'analyzing', elapsed: 0 });
  });
});

describe('executeTextModel — cancellation', () => {
  it('short-circuits when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = ai({ text: 'never' } as unknown as GenerateTextResult);
    const out = await executeTextModel({ ai: client, model: model(), params, signal: controller.signal });
    expect(out.status).toBe('cancelled');
    expect(out.results).toEqual([]);
    expect(client.generateText).not.toHaveBeenCalled();
  });
});

/**
 * Text execution — LLM / text models (`mode === 'text'`).
 *
 * Unlike media models, these route through the SDK's `generateText()`
 * (NOT `generate()`, which the SDK types exclude for text models) and
 * return a string in `result.text` instead of a media URL. The result
 * carries `text` and an empty `results[]` so the output layer prints
 * the text and skips download / Drive save.
 *
 * No UI imports. Returns ExecutionResult.
 */
import type { GenerateTextResult, GenerationContext, ModelDefinition, TextModelId } from '@picsart/ai-sdk';
import type { ExecutionResult, ProgressCallback } from '#root/types.ts';

interface TextContext {
  ai: {
    generateText: (
      model: TextModelId,
      params: GenerationContext,
      options?: { signal?: AbortSignal },
    ) => Promise<GenerateTextResult>;
  };
  model: ModelDefinition;
  params: GenerationContext;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export async function executeTextModel(ctx: TextContext): Promise<ExecutionResult> {
  const startTime = Date.now();

  ctx.onProgress?.({ status: 'analyzing', elapsed: 0 });

  if (ctx.signal?.aborted) {
    return {
      status: 'cancelled',
      results: [],
      model: ctx.model,
      params: ctx.params as unknown as Record<string, unknown>,
      durationMs: Date.now() - startTime,
    };
  }

  const result = await ctx.ai.generateText(ctx.model.id as TextModelId, ctx.params, { signal: ctx.signal });

  return {
    status: 'completed',
    text: result.text,
    results: [],
    model: ctx.model,
    params: ctx.params as unknown as Record<string, unknown>,
    durationMs: Date.now() - startTime,
  };
}

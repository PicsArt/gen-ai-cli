/**
 * Sync execution — single request/response models.
 * No UI imports. Returns ExecutionResult.
 */
import type { GenerateResult, GenerationContext, ModelDefinition, TypedModelId } from '@picsart/ai-sdk';
import type { ExecutionResult, ProgressCallback } from '#root/types.ts';

interface SyncContext {
  ai: { generate: (model: TypedModelId, ctx: GenerationContext) => Promise<GenerateResult> };
  model: ModelDefinition;
  params: GenerationContext;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export async function executeSyncModel(ctx: SyncContext): Promise<ExecutionResult> {
  const startTime = Date.now();

  ctx.onProgress?.({ status: 'generating', elapsed: 0 });

  if (ctx.signal?.aborted) {
    return {
      status: 'cancelled',
      results: [],
      model: ctx.model,
      params: ctx.params as unknown as Record<string, unknown>,
      durationMs: Date.now() - startTime,
    };
  }

  const result = await ctx.ai.generate(ctx.model.id as TypedModelId, ctx.params);

  return {
    status: 'completed',
    url: result.url,
    results: result.results.map((r) => ({
      url: r.url,
      type: ctx.model.mode,
      // Multi-result models (Recraft Explore) tag each output with a
      // server-side ID under `metadata.exploreImageId`. Surface it so
      // `--source-image-id` follow-ups work.
      ...(typeof r.metadata?.exploreImageId === 'string'
        ? { exploreImageId: r.metadata.exploreImageId as string }
        : {}),
    })),
    model: ctx.model,
    params: ctx.params as unknown as Record<string, unknown>,
    durationMs: Date.now() - startTime,
  };
}

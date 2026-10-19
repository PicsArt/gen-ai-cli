/**
 * Async execution — submit, poll with progress, collect result.
 * No UI imports. Returns ExecutionResult.
 */
import type { GenerationContext, GenerationEvent, ModelDefinition, TypedModelId } from '@picsart/ai-sdk';
import type { ExecutionResult, ProgressCallback } from '#root/types.ts';
import { computePollingBudget } from './budget.ts';

interface AsyncContext {
  ai: {
    /** Submit a job and return its generation id (string handle). */
    submit: (model: TypedModelId, ctx: GenerationContext, opts?: { signal?: AbortSignal }) => Promise<string>;
    /** Subscribe to live events for a submitted job. The `generation.completed`
     *  event carries the parsed result, so no follow-up `result()` call is needed. */
    subscribe: (
      model: TypedModelId,
      generationId: string,
      opts?: { intervalMs?: number; maxAttempts?: number; signal?: AbortSignal },
    ) => AsyncGenerator<GenerationEvent, void, void>;
  };
  model: ModelDefinition;
  params: GenerationContext;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/** SDK 6 reports timeout ApiErrors as failed events; retain thrown-error support. */
function isSdkPollingTimeout(err: unknown): boolean {
  return (
    err instanceof Error &&
    (('code' in err && err.code === 'timeout') || err.message.startsWith('Timed out waiting for workflow'))
  );
}

export async function executeAsyncModel(ctx: AsyncContext): Promise<ExecutionResult> {
  const startTime = Date.now();
  const intervalMs = ctx.pollIntervalMs ?? 3000;
  const { maxAttempts, totalMs } = computePollingBudget(ctx.model, intervalMs, ctx.pollTimeoutMs);

  const cancelled = (taskId?: string): ExecutionResult => ({
    status: 'cancelled',
    results: [],
    model: ctx.model,
    params: ctx.params as unknown as Record<string, unknown>,
    durationMs: Date.now() - startTime,
    ...(taskId ? { taskId } : {}),
  });
  const timeout = (taskId: string): ExecutionResult => ({
    status: 'timeout',
    results: [],
    model: ctx.model,
    params: ctx.params as unknown as Record<string, unknown>,
    durationMs: Date.now() - startTime,
    taskId,
    error: `Job is still running on the server after ${Math.round(totalMs / 60_000)} min. Track it with \`gen-ai history\` before submitting another generation.`,
  });

  if (ctx.signal?.aborted) return cancelled();
  let generationId: string;
  try {
    generationId = await ctx.ai.submit(ctx.model.id as TypedModelId, ctx.params, { signal: ctx.signal });
  } catch (err) {
    if (ctx.signal?.aborted) return cancelled();
    throw err;
  }
  if (ctx.signal?.aborted) return cancelled(generationId);
  const subscription = ctx.ai.subscribe(ctx.model.id as TypedModelId, generationId, {
    intervalMs,
    maxAttempts,
    signal: ctx.signal,
  });

  try {
    for await (const event of subscription) {
      if (ctx.signal?.aborted) {
        await subscription.return(undefined);
        return cancelled(generationId);
      }

      const elapsed = Date.now() - startTime;

      if (event.type === 'generation.progress') {
        ctx.onProgress?.({
          percent: event.progress?.percent ?? undefined,
          status: 'processing',
          elapsed,
        });
        continue;
      }

      if (event.type === 'generation.completed') {
        const result = event.result;
        return {
          status: 'completed',
          url: result.url,
          results: result.items.map((r) => ({
            url: r.url,
            type: ctx.model.mode,
            // Preserve server-side IDs from multi-result models (Recraft
            // Explore). The SDK exposes them on `metadata.exploreImageId`;
            // surface so `--source-image-id` follow-ups work.
            ...(typeof r.metadata?.exploreImageId === 'string'
              ? { exploreImageId: r.metadata.exploreImageId as string }
              : {}),
          })),
          model: ctx.model,
          params: ctx.params as unknown as Record<string, unknown>,
          durationMs: Date.now() - startTime,
          taskId: generationId,
        };
      }

      if (event.type === 'generation.failed') {
        if (isSdkPollingTimeout(event.error)) return timeout(generationId);
        if (event.error.code === 'aborted' || event.error.code === 'canceled') return cancelled(generationId);
        return {
          status: 'failed',
          results: [],
          model: ctx.model,
          params: ctx.params as unknown as Record<string, unknown>,
          durationMs: Date.now() - startTime,
          taskId: generationId,
          error: event.error.message || 'Generation failed',
        };
      }
    }
  } catch (err) {
    await subscription.return(undefined);
    if (ctx.signal?.aborted) return cancelled(generationId);
    if (isSdkPollingTimeout(err)) return timeout(generationId);
    throw err;
  }

  // Subscription ended without terminal status
  return {
    status: 'failed',
    results: [],
    model: ctx.model,
    params: ctx.params as unknown as Record<string, unknown>,
    durationMs: Date.now() - startTime,
    taskId: generationId,
    error: 'Job ended without terminal status',
  };
}

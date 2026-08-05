/**
 * Async execution — submit, poll with progress, collect result.
 * No UI imports. Returns ExecutionResult.
 */
import type {
  GenerateResult,
  GenerationContext,
  ModelDefinition,
  TypedModelId,
  WorkflowJobHandle,
} from '@picsart/ai-sdk';
import type { ExecutionResult, ProgressCallback } from '#root/types.ts';
import { computePollingBudget } from './budget.ts';

interface StatusUpdate {
  status: string;
  progress?: { percent?: number };
  error?: string;
}

interface AsyncContext {
  ai: {
    submit: (model: TypedModelId, ctx: GenerationContext) => Promise<WorkflowJobHandle>;
    subscribe: (
      handle: WorkflowJobHandle,
      opts?: { intervalMs?: number; maxAttempts?: number },
    ) => AsyncGenerator<StatusUpdate, StatusUpdate, void>;
    result: (handle: WorkflowJobHandle, model: TypedModelId) => Promise<GenerateResult>;
  };
  model: ModelDefinition;
  params: GenerationContext;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/** Detect the SDK's polling-timeout sentinel (workflow.ts throws a raw Error). */
function isSdkPollingTimeout(err: unknown): err is Error {
  return err instanceof Error && err.message.startsWith('Timed out waiting for workflow');
}

export async function executeAsyncModel(ctx: AsyncContext): Promise<ExecutionResult> {
  const startTime = Date.now();
  const intervalMs = ctx.pollIntervalMs ?? 3000;
  const { maxAttempts, totalMs } = computePollingBudget(ctx.model, intervalMs, ctx.pollTimeoutMs);

  const handle = await ctx.ai.submit(ctx.model.id as TypedModelId, ctx.params);
  const subscription = ctx.ai.subscribe(handle, { intervalMs, maxAttempts });

  try {
    for await (const status of subscription) {
      if (ctx.signal?.aborted) {
        await subscription.return(status);
        return {
          status: 'cancelled',
          results: [],
          model: ctx.model,
          params: ctx.params as unknown as Record<string, unknown>,
          durationMs: Date.now() - startTime,
          taskId: handle.id,
        };
      }

      const elapsed = Date.now() - startTime;
      ctx.onProgress?.({
        percent: status.progress?.percent ?? undefined,
        status: status.status,
        elapsed,
      });

      if (status.status === 'COMPLETED') {
        const result = await ctx.ai.result(handle, ctx.model.id as TypedModelId);
        return {
          status: 'completed',
          url: result.url,
          results: result.results.map((r) => ({
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
          taskId: handle.id,
        };
      }

      if (status.status === 'FAILED') {
        return {
          status: 'failed',
          results: [],
          model: ctx.model,
          params: ctx.params as unknown as Record<string, unknown>,
          durationMs: Date.now() - startTime,
          taskId: handle.id,
          error: status.error ?? 'Generation failed',
        };
      }
    }
  } catch (err) {
    await subscription.return(undefined as unknown as StatusUpdate);
    if (isSdkPollingTimeout(err)) {
      const minutes = Math.round(totalMs / 60_000);
      return {
        status: 'timeout',
        results: [],
        model: ctx.model,
        params: ctx.params as unknown as Record<string, unknown>,
        durationMs: Date.now() - startTime,
        taskId: handle.id,
        error: `Job is still running on the server after ${minutes} min. Track it with \`gen-ai history\` or rerun later.`,
      };
    }
    throw err;
  }

  // Subscription ended without terminal status
  return {
    status: 'failed',
    results: [],
    model: ctx.model,
    params: ctx.params as unknown as Record<string, unknown>,
    durationMs: Date.now() - startTime,
    taskId: handle.id,
    error: 'Job ended without terminal status',
  };
}

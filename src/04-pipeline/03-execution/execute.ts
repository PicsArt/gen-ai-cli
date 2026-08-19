/**
 * Main execution entry point — routes to sync or async execution.
 *
 * Per Decision 2: file uploads happen at the RESOLVER stage. By the time
 * execute() runs, `inputs.files` already contains URLs (not local paths).
 * Execution just merges the URLs into the SDK params and dispatches.
 *
 *   - SDK client: `getAiClient()` (services)
 *   - Routing: sync models → executeSyncModel(); others → executeAsyncModel()
 */

import type { GenerationContext, MediaModelId, TextModelId, TypedModelId } from '@picsart/ai-sdk';
import type { ExecutionDeps } from '#root/deps.ts';
import type { ExecutionResult, ProgressCallback, ResolvedInputs } from '#root/types.ts';
import { getAiClient } from '#services/client.ts';
import { executeAsyncModel } from './async.ts';
import { executeSyncModel } from './sync.ts';
import { executeTextModel } from './text.ts';

export interface ExecutionOptions {
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export async function execute(
  inputs: ResolvedInputs,
  _deps: ExecutionDeps,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  const ai = await getAiClient();

  // inputs.files now contains URLs (resolver did the upload).
  // Kling-only file fields (staticMask, sceneImage, styleImage) ride through
  // as extra keys — the SDK reads them via ModelInput<'kling-*'> at the
  // per-model boundary, so they don't need to be on GenerationContext.
  const files = inputs.files;
  const params: GenerationContext & Record<string, unknown> = {
    prompt: '',
    ...(inputs.params as Partial<GenerationContext>),
    ...(files.images && files.images.length > 0 ? { imageUrls: files.images } : {}),
    ...(files.startFrame ? { startFrame: files.startFrame } : {}),
    ...(files.endFrame ? { endFrame: files.endFrame } : {}),
    ...(files.video ? { videoUrl: files.video } : {}),
    ...(files.audio ? { audioUrl: files.audio } : {}),
    ...(files.videos && files.videos.length > 0 ? { videoUrls: files.videos } : {}),
    ...(files.audios && files.audios.length > 0 ? { audioUrls: files.audios } : {}),
    ...(files.staticMask ? { staticMask: files.staticMask } : {}),
    ...(files.sceneImage ? { sceneImage: files.sceneImage } : {}),
    ...(files.styleImage ? { styleImage: files.styleImage } : {}),
    ...(files.styleReferences && files.styleReferences.length > 0 ? { styleReferenceUrls: files.styleReferences } : {}),
  };

  const model = inputs.model;

  // Text/LLM models return a string via generateText() — the SDK types
  // exclude them from generate(). Route them before the sync/async split.
  if (model.mode === 'text') {
    return executeTextModel({
      ai: {
        generateText: (modelId: TextModelId, ctx: GenerationContext, opts?: { signal?: AbortSignal }) =>
          ai.generateText(modelId, ctx as Record<string, unknown> & { prompt: string }, opts),
      },
      model,
      params,
      signal: options?.signal,
      onProgress: options?.onProgress,
    });
  }

  if (model.syncExecute) {
    return executeSyncModel({
      ai: {
        generate: (modelId: TypedModelId, ctx: GenerationContext) =>
          // Text models are routed out above, so this is always a media model.
          ai.generate(modelId as MediaModelId, ctx as Record<string, unknown> & { prompt: string }),
      },
      model,
      params,
      signal: options?.signal,
      onProgress: options?.onProgress,
    });
  }

  return executeAsyncModel({
    ai: {
      submit: (modelId: TypedModelId, ctx: GenerationContext) =>
        ai.submit(modelId as MediaModelId, ctx as Record<string, unknown> & { prompt: string }),
      subscribe: (handle, opts) => ai.subscribe(handle, opts),
      result: (handle, modelId: TypedModelId) => ai.result(handle, modelId as MediaModelId),
    },
    model,
    params,
    signal: options?.signal,
    onProgress: options?.onProgress,
    pollIntervalMs: options?.pollIntervalMs,
    pollTimeoutMs: options?.pollTimeoutMs,
  });
}

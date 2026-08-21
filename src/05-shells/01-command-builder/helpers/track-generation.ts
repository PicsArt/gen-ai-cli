/**
 * Pulse analytics — generation-command instrumentation.
 *
 * Two events per invocation, forming a start → finish funnel:
 *
 *   - `trackGenerationStarted`   — fired right before `execute` submits the
 *     job to the model. Captures flow, model, params, files.
 *   - `trackGenerationCompleted` — fired once the invocation reaches a
 *     terminal state. Carries `status` (completed / failed / cancelled /
 *     timeout) so success AND failure share one event; on failure it also
 *     carries `error_name` / `error_message`. Called both from the success
 *     path (with a `result`) and from the catch / SIGINT paths (with an
 *     `error` and an explicit `status`). `inputs` is absent when the throw
 *     happened before input resolution completed (e.g. model not found).
 *
 * The `pulse` proxy from `@pulse/core` resolves to the tracker set up at the
 * CLI entry point (see `src/index.ts` → `runWithPulse`). Inside that context,
 * fire-and-forget — the SDK swallows transport errors and never throws.
 *
 * Privacy:
 *   - `params` is sent as-is. By the time it reaches here, file slots have
 *     been resolved to URLs by `resolveAllFiles`, so local paths shouldn't
 *     leak. A defensive heuristic still scrubs any value that still looks
 *     like a local path.
 *   - Prompts are sent as-is by default. Set `PULSE_REDACT_PROMPTS=1` to
 *     replace `params.prompt` with the literal `"[redacted]"`.
 */

import * as path from 'node:path';
import { pulse } from '@pulse/core';
import type { FlowSpec } from '#flows';
import type { ExecutionResult, ResolvedInputs } from '#root/types.ts';

export interface TrackStartContext {
  flow: FlowSpec;
  flags: Record<string, unknown>;
  inputs: ResolvedInputs;
}

export interface TrackContext {
  flow: FlowSpec;
  flags: Record<string, unknown>;
  inputs?: ResolvedInputs;
  /** Present on the success path; absent when the pipeline threw. */
  result?: ExecutionResult;
  /** Present on the catch / SIGINT paths. */
  error?: unknown;
  /**
   * Terminal status when there is no `result` to read it from
   * (e.g. `'failed'` for a pipeline throw, `'cancelled'` for SIGINT).
   * Ignored when `result` is present.
   */
  status?: string;
}

/* ── Start path ──────────────────────────────────────────────── */

export function trackGenerationStarted(ctx: TrackStartContext): void {
  pulse.event({
    event: 'cli_generation_started',
    data: {
      flow_id: ctx.flow.id,
      model_id: ctx.inputs.model.id,
      model_name: ctx.inputs.model.name,
      model_vendor: ctx.inputs.model.provider,

      params: sanitizeParams(ctx.inputs.params),
      files: summarizeFiles(ctx.inputs.files),
    },
  });
}

/* ── Terminal path (success + failure) ───────────────────────── */

export function trackGenerationCompleted(ctx: TrackContext): void {
  const { result, error, inputs } = ctx;
  // Status comes from the result when we have one; otherwise from the
  // explicit override the caller passed on the throw / cancel path.
  const status = result?.status ?? ctx.status ?? 'failed';

  pulse.event({
    event: 'cli_generation_completed',
    data: {
      flow_id: ctx.flow.id,
      model_id: inputs?.model.id,
      model_name: inputs?.model.name,
      model_vendor: inputs?.model.provider,

      status,
      duration_ms: result?.durationMs,
      task_id: result?.taskId,
      result_count: result?.results.length,

      // Failure detail, only when the invocation ended on an error. No stack —
      // keep events small. Error class name (UsageError, AuthError, ApiError…)
      // plus the human-readable message.
      error_name: error === undefined ? undefined : error instanceof Error ? error.constructor.name : 'Unknown',
      error_message: error === undefined ? undefined : error instanceof Error ? error.message : String(error),

      params: inputs ? sanitizeParams(inputs.params) : undefined,
      files: inputs ? summarizeFiles(inputs.files) : undefined,
    },
  });
}

/* ── Helpers ─────────────────────────────────────────────────── */

/**
 * Pass params through, with two safeties:
 *   1. Optional prompt redaction (env var).
 *   2. Replace any value that still looks like a local filesystem path
 *      with `"[file:<ext>]"` — defense-in-depth, shouldn't trigger in
 *      practice because file slots resolve to URLs upstream.
 */
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const redactPrompts = process.env.PULSE_REDACT_PROMPTS === '1';
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (key === 'prompt' && redactPrompts) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' && looksLikeLocalPath(value)) {
      out[key] = `[file:${path.extname(value).slice(1) || 'unknown'}]`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function summarizeFiles(files: ResolvedInputs['files']): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (files.images?.length) summary.images_count = files.images.length;
  if (files.startFrame) summary.has_start_frame = true;
  if (files.endFrame) summary.has_end_frame = true;
  if (files.video) summary.has_video = true;
  if (files.audio) summary.has_audio = true;
  if (files.videos?.length) summary.videos_count = files.videos.length;
  if (files.audios?.length) summary.audios_count = files.audios.length;
  return summary;
}

function looksLikeLocalPath(s: string): boolean {
  if (s.startsWith('http://') || s.startsWith('https://')) return false;
  if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../') || s.startsWith('~')) return true;
  // Windows absolute path: C:\... or D:/...
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;
  return false;
}

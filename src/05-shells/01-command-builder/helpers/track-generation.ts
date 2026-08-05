/**
 * Pulse analytics — generation-command instrumentation.
 *
 * Called from `runOperation()` exactly twice per invocation:
 *   - `trackGenerationCompleted` — after `execute` resolves (any status).
 *   - `trackGenerationFailed`    — from the catch branch when any pipeline
 *     step from `resolveInputs` onward throws. `inputs` is absent when the
 *     throw happened before input resolution completed (e.g. model not found).
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

export interface TrackContext {
  flow: FlowSpec;
  flags: Record<string, unknown>;
  inputs: ResolvedInputs;
  result: ExecutionResult;
}

export interface TrackFailureContext {
  flow: FlowSpec;
  flags: Record<string, unknown>;
  inputs?: ResolvedInputs;
  error: unknown;
}

/* ── Success / terminal path ─────────────────────────────────── */

export function trackGenerationCompleted(ctx: TrackContext): void {
  pulse.event({
    event: 'cli_generation_completed',
    data: {
      flow_id: ctx.flow.id,
      model_id: ctx.inputs.model.id,
      model_name: ctx.inputs.model.name,
      model_vendor: ctx.inputs.model.provider,

      status: ctx.result.status,
      duration_ms: ctx.result.durationMs,
      task_id: ctx.result.taskId,
      result_count: ctx.result.results.length,

      params: sanitizeParams(ctx.inputs.params),
      files: summarizeFiles(ctx.inputs.files),
    },
  });
}

/* ── Error path ──────────────────────────────────────────────── */

export function trackGenerationFailed(ctx: TrackFailureContext): void {
  const err = ctx.error;
  pulse.event({
    event: 'cli_generation_failed',
    data: {
      flow_id: ctx.flow.id,
      model_id: ctx.inputs?.model.id,
      model_name: ctx.inputs?.model.name,

      // Error class name (e.g. UsageError, AuthError, ApiError) +
      // human-readable message. No stack — keep events small.
      error_name: err instanceof Error ? err.constructor.name : 'Unknown',
      error_message: err instanceof Error ? err.message : String(err),

      params: ctx.inputs ? sanitizeParams(ctx.inputs.params) : undefined,
      files: ctx.inputs ? summarizeFiles(ctx.inputs.files) : undefined,
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

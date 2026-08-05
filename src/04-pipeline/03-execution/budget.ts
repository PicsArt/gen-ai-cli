/**
 * Polling-budget calculator.
 *
 * The SDK's `subscribe()` will throw `Timed out waiting for workflow …`
 * after `maxAttempts` polls. We pick that budget per model so that long-
 * running video/audio jobs don't hit the default 10-minute ceiling, and
 * allow callers (via `--poll-timeout`) to override.
 *
 * `estimatedTime` from the model definition is intentionally ignored:
 * it drives the progress-bar ETA and is optimistic on most video models.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';

const TEN_MINUTES_MS = 10 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export interface PollingBudget {
  /** Total polling budget in milliseconds (informational, also used in error text). */
  totalMs: number;
  /** Number of poll attempts to pass to `ai.subscribe({ maxAttempts })`. */
  maxAttempts: number;
}

export function computePollingBudget(model: ModelDefinition, intervalMs: number, overrideMs?: number): PollingBudget {
  let totalMs: number;
  if (typeof overrideMs === 'number' && overrideMs > 0) {
    totalMs = overrideMs;
  } else {
    const isLongRunning = model.mode === 'video' || model.mode === 'audio';
    totalMs = isLongRunning ? THIRTY_MINUTES_MS : TEN_MINUTES_MS;
  }
  return { totalMs, maxAttempts: Math.ceil(totalMs / intervalMs) };
}

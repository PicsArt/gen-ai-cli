/**
 * Spec for the generation analytics helper.
 *
 * Contracts:
 *   trackGenerationCompleted(ctx):
 *     - fires one Pulse event named 'cli_generation_completed'
 *     - includes flow_id, model_id/name, status, duration_ms, task_id, result_count
 *     - includes sanitized params and summarized files
 *
 *   trackGenerationFailed(ctx):
 *     - fires one Pulse event named 'cli_generation_failed'
 *     - includes error_name (constructor name) and error_message
 *     - handles non-Error throwables (strings, numbers)
 *     - tolerates missing inputs (resolve-time failure path)
 *
 *   sanitization (via the completed event):
 *     - leaves URLs and primitive values alone
 *     - replaces local-path-looking strings with [file:<ext>]
 *     - redacts params.prompt when PULSE_REDACT_PROMPTS=1
 *
 *   file summarization (via the completed event):
 *     - reports images_count for the images array
 *     - reports boolean flags for single-slot files
 *     - returns {} when no files are present
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowSpec } from '#flows';
import type { ExecutionResult, ResolvedInputs } from '#root/types.ts';

const pulseEventMock = vi.hoisted(() => vi.fn());

vi.mock('@pulse/core', () => ({ pulse: { event: pulseEventMock } }));

import { trackGenerationCompleted, trackGenerationFailed } from './track-generation.ts';

beforeEach(() => {
  pulseEventMock.mockReset();
  delete process.env.PULSE_REDACT_PROMPTS;
});

afterEach(() => {
  delete process.env.PULSE_REDACT_PROMPTS;
});

/* ── Fixtures ────────────────────────────────────────────────── */

function makeFlow(): FlowSpec {
  return { id: 'image' } as unknown as FlowSpec;
}

function makeInputs(overrides: Partial<ResolvedInputs> = {}): ResolvedInputs {
  return {
    model: { id: 'photon', name: 'Photon', provider: 'luma' } as ResolvedInputs['model'],
    params: { prompt: 'cat', width: 1024 },
    files: {},
    ...overrides,
  };
}

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    status: 'completed',
    durationMs: 5000,
    taskId: 'task-1',
    results: [{ url: 'https://x/a.png', type: 'image' }],
    model: { id: 'photon', name: 'Photon' } as ExecutionResult['model'],
    params: {},
    ...overrides,
  };
}

/** Extract the data payload of the most recent Pulse event call. */
function lastEventData(): Record<string, unknown> {
  const call = pulseEventMock.mock.calls.at(-1)?.[0] as {
    data: Record<string, unknown>;
  };
  return call.data;
}

/* ── trackGenerationCompleted ────────────────────────────────── */

describe('trackGenerationCompleted', () => {
  it('fires one event with the expected core fields', () => {
    trackGenerationCompleted({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs(),
      result: makeResult(),
    });

    expect(pulseEventMock).toHaveBeenCalledTimes(1);
    const call = pulseEventMock.mock.calls[0][0] as {
      event: string;
      data: Record<string, unknown>;
    };
    expect(call.event).toBe('cli_generation_completed');
    expect(call.data).toMatchObject({
      flow_id: 'image',
      model_id: 'photon',
      model_name: 'Photon',
      // Regression: this used to read the nonexistent `model.vendor` field
      // and always sent undefined — must come from `model.provider`.
      model_vendor: 'luma',
      status: 'completed',
      duration_ms: 5000,
      task_id: 'task-1',
      result_count: 1,
    });
  });

  it('fires the event regardless of terminal status (failed/cancelled/timeout)', () => {
    for (const status of ['failed', 'cancelled', 'timeout'] as const) {
      pulseEventMock.mockReset();
      trackGenerationCompleted({
        flow: makeFlow(),
        flags: {},
        inputs: makeInputs(),
        result: makeResult({ status }),
      });
      expect(lastEventData().status).toBe(status);
    }
  });

  it('summarizes files: images_count + single-slot booleans', () => {
    trackGenerationCompleted({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs({
        files: {
          images: ['a', 'b', 'c'],
          startFrame: 's',
          video: 'v',
        },
      }),
      result: makeResult(),
    });

    expect(lastEventData().files).toEqual({
      images_count: 3,
      has_start_frame: true,
      has_video: true,
    });
  });

  it('returns an empty files object when no files were used', () => {
    trackGenerationCompleted({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs(),
      result: makeResult(),
    });
    expect(lastEventData().files).toEqual({});
  });

  it('sends params through unchanged for normal values', () => {
    trackGenerationCompleted({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs({ params: { prompt: 'cat', width: 1024, count: 4 } }),
      result: makeResult(),
    });

    expect(lastEventData().params).toEqual({
      prompt: 'cat',
      width: 1024,
      count: 4,
    });
  });

  it('replaces local-path-looking values with [file:<ext>]', () => {
    trackGenerationCompleted({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs({
        params: {
          relPath: './photo.jpg',
          absPath: '/Users/test/file.mp4',
          homePath: '~/Downloads/song.mp3',
          notALocalPath: 'plain string',
        },
      }),
      result: makeResult(),
    });

    const params = lastEventData().params as Record<string, unknown>;
    expect(params.relPath).toBe('[file:jpg]');
    expect(params.absPath).toBe('[file:mp4]');
    expect(params.homePath).toBe('[file:mp3]');
    expect(params.notALocalPath).toBe('plain string');
  });

  it('leaves URLs alone (treats them as already-resolved upload URLs)', () => {
    trackGenerationCompleted({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs({
        params: { imageUrl: 'https://upload.example.com/123.png' },
      }),
      result: makeResult(),
    });

    const params = lastEventData().params as Record<string, unknown>;
    expect(params.imageUrl).toBe('https://upload.example.com/123.png');
  });

  it('redacts params.prompt when PULSE_REDACT_PROMPTS=1', () => {
    process.env.PULSE_REDACT_PROMPTS = '1';
    trackGenerationCompleted({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs({ params: { prompt: 'something sensitive', steps: 30 } }),
      result: makeResult(),
    });

    const params = lastEventData().params as Record<string, unknown>;
    expect(params.prompt).toBe('[redacted]');
    expect(params.steps).toBe(30);
  });

  it('does NOT redact prompt by default', () => {
    trackGenerationCompleted({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs({ params: { prompt: 'mountain at sunset' } }),
      result: makeResult(),
    });

    expect((lastEventData().params as Record<string, unknown>).prompt).toBe('mountain at sunset');
  });
});

/* ── trackGenerationFailed ───────────────────────────────────── */

describe('trackGenerationFailed', () => {
  it('fires one event with error_name (constructor) and error_message', () => {
    class UsageError extends Error {}
    trackGenerationFailed({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs(),
      error: new UsageError('bad flag'),
    });

    expect(pulseEventMock).toHaveBeenCalledTimes(1);
    expect(pulseEventMock.mock.calls[0][0]).toMatchObject({
      event: 'cli_generation_failed',
      data: expect.objectContaining({
        flow_id: 'image',
        model_id: 'photon',
        error_name: 'UsageError',
        error_message: 'bad flag',
      }),
    });
  });

  it('handles non-Error throwables (string)', () => {
    trackGenerationFailed({
      flow: makeFlow(),
      flags: {},
      error: 'just a string',
    });

    expect(lastEventData()).toMatchObject({
      error_name: 'Unknown',
      error_message: 'just a string',
    });
  });

  it('handles non-Error throwables (number)', () => {
    trackGenerationFailed({
      flow: makeFlow(),
      flags: {},
      error: 42,
    });

    expect(lastEventData()).toMatchObject({
      error_name: 'Unknown',
      error_message: '42',
    });
  });

  it('omits model/params/files when inputs are absent (resolve failure)', () => {
    trackGenerationFailed({
      flow: makeFlow(),
      flags: {},
      error: new Error('resolve failed'),
    });

    const data = lastEventData();
    expect(data.model_id).toBeUndefined();
    expect(data.model_name).toBeUndefined();
    expect(data.params).toBeUndefined();
    expect(data.files).toBeUndefined();
  });

  it('sanitizes params on the failure path too', () => {
    trackGenerationFailed({
      flow: makeFlow(),
      flags: {},
      inputs: makeInputs({ params: { imageUrl: './photo.jpg' } }),
      error: new Error('upstream failed'),
    });

    expect((lastEventData().params as Record<string, unknown>).imageUrl).toBe('[file:jpg]');
  });
});

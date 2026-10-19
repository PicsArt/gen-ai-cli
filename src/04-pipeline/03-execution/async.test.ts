/**
 * Spec for execution/async.
 *
 * Contract:
 *   executeAsyncModel(ctx):
 *     - submits via ai.submit (returns a generation id string), then iterates ai.subscribe
 *     - emits onProgress for each `generation.progress` event
 *     - on 'generation.completed' → returns completed ExecutionResult from the
 *       event's carried result (no separate ai.result call)
 *     - on 'generation.failed'    → returns failed ExecutionResult with error
 *     - on abort signal → returns cancelled (no further work)
 *     - taskId is the generation id
 *     - returns 'failed' if subscription ends without terminal event
 */
import type {
  GenerateResult,
  GenerationContext,
  GenerationEvent,
  ModelDefinition,
  TypedModelId,
} from '@picsart/ai-sdk';
import { ApiError } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import { executeAsyncModel } from './async.ts';

function model(): ModelDefinition {
  return { id: 'veo-3', name: 'Veo 3', mode: 'video' } as ModelDefinition;
}
const params: GenerationContext = { prompt: 'a sunset' } as GenerationContext;
const GENERATION_ID = 'job-123';

/* Event builders — construct the 6.x GenerationEvent discriminated union. */
const progress = (percent?: number): GenerationEvent => ({
  type: 'generation.progress',
  progress: percent == null ? undefined : { percent },
});
const completed = (result: GenerateResult): GenerationEvent => ({ type: 'generation.completed', result });
const failed = (message: string): GenerationEvent => ({
  type: 'generation.failed',
  error: new Error(message) as ApiError,
});

async function* yieldEvents(events: GenerationEvent[]): AsyncGenerator<GenerationEvent, void, void> {
  for (const e of events) yield e;
}

function ai(events: GenerationEvent[]) {
  // Typed params document the SDK contract under test; args are unused at call
  // time — tests assert via toHaveBeenCalledWith, not by reading them.
  return {
    submit: vi.fn(async (_id: TypedModelId, _ctx: GenerationContext) => GENERATION_ID),
    subscribe: vi.fn((_id: TypedModelId, _gid: string, _opts?: { intervalMs?: number; maxAttempts?: number }) =>
      yieldEvents(events),
    ),
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  COMPLETED                                                             */
/* ─────────────────────────────────────────────────────────────────────── */

describe('executeAsyncModel — COMPLETED', () => {
  it('returns completed with url + mapped results + taskId', async () => {
    const client = ai([
      progress(50),
      completed({ url: 'https://x/v.mp4', items: [{ url: 'https://x/v.mp4' }] } as unknown as GenerateResult),
    ]);
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('completed');
    expect(out.url).toBe('https://x/v.mp4');
    expect(out.results[0]?.type).toBe('video');
    expect(out.taskId).toBe(GENERATION_ID);
    expect(client.submit).toHaveBeenCalledWith('veo-3', params, { signal: undefined });
  });

  it('emits onProgress for each progress event with percent + elapsed', async () => {
    const client = ai([progress(25), progress(75), completed({ url: 'x', items: [] } as unknown as GenerateResult)]);
    const onProgress = vi.fn();
    await executeAsyncModel({ ai: client, model: model(), params, onProgress });
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onProgress.mock.calls[0][0].percent).toBe(25);
    expect(onProgress.mock.calls[1][0].percent).toBe(75);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  FAILED                                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('executeAsyncModel — FAILED', () => {
  it('returns failed with the error message from the event', async () => {
    const client = ai([failed('workflow blew up')]);
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('failed');
    expect(out.error).toBe('workflow blew up');
    expect(out.taskId).toBe(GENERATION_ID);
  });

  it('uses fallback error text when the event error message is empty', async () => {
    const client = ai([failed('')]);
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.error).toBe('Generation failed');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Cancellation                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('executeAsyncModel — cancellation', () => {
  it('does not submit when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(); // must prevent a paid submission
    const client = ai([progress(), completed({ url: 'x', items: [] } as unknown as GenerateResult)]);
    const out = await executeAsyncModel({
      ai: client,
      model: model(),
      params,
      signal: controller.signal,
    });
    expect(out.status).toBe('cancelled');
    expect(out.taskId).toBeUndefined();
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
  });

  it('propagates the signal and cancels while waiting for the next event', async () => {
    const controller = new AbortController();
    const client = {
      submit: vi.fn(async () => GENERATION_ID),
      subscribe: vi.fn(async function* (_id: TypedModelId, _gid: string, opts?: { signal?: AbortSignal }) {
        yield progress(10);
        await new Promise<void>((resolve) => {
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
          controller.abort();
        });
        yield {
          type: 'generation.failed',
          error: new ApiError('aborted', { code: 'aborted', status: 499 }),
        } as GenerationEvent;
      }),
    };
    const out = await executeAsyncModel({ ai: client, model: model(), params, signal: controller.signal });
    expect(client.submit).toHaveBeenCalledWith('veo-3', params, { signal: controller.signal });
    expect(client.subscribe).toHaveBeenCalledWith(
      'veo-3',
      GENERATION_ID,
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(out.status).toBe('cancelled');
    expect(out.taskId).toBe(GENERATION_ID);
  });

  it('returns cancelled if submission is aborted without starting a subscription', async () => {
    const controller = new AbortController();
    const client = ai([]);
    client.submit.mockImplementation(async () => {
      controller.abort();
      throw new ApiError('aborted', { code: 'aborted', status: 499 });
    });
    const out = await executeAsyncModel({ ai: client, model: model(), params, signal: controller.signal });
    expect(out.status).toBe('cancelled');
    expect(client.subscribe).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Subscription ends without terminal                                    */
/* ─────────────────────────────────────────────────────────────────────── */

describe('executeAsyncModel — no terminal event', () => {
  it('returns failed when subscription drains without completed/failed', async () => {
    const client = ai([progress(), progress()]);
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/terminal|ended/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  SDK timeout                                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('executeAsyncModel — SDK polling timeout', () => {
  it('recognizes SDK 6 timeout failed events by error code and preserves the generation id', async () => {
    const client = ai([
      progress(10),
      { type: 'generation.failed', error: new ApiError('Polling budget exhausted', { code: 'timeout', status: 408 }) },
    ]);
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('timeout');
    expect(out.taskId).toBe(GENERATION_ID);
    expect(out.error).toMatch(/still running/i);
  });

  it("returns 'timeout' status with taskId when SDK throws 'Timed out waiting for workflow' mid-stream", async () => {
    async function* timeoutAfterOne(): AsyncGenerator<GenerationEvent, void, void> {
      yield progress(10);
      throw new Error('Timed out waiting for workflow seedance:job-123');
    }
    const client = {
      submit: vi.fn(async () => GENERATION_ID),
      subscribe: vi.fn(() => timeoutAfterOne()),
    };
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('timeout');
    expect(out.taskId).toBe(GENERATION_ID);
    expect(out.error).toMatch(/still running/i);
  });

  it('passes maxAttempts derived from the model mode to subscribe', async () => {
    const client = ai([completed({ url: 'x', items: [] } as unknown as GenerateResult)]);
    await executeAsyncModel({ ai: client, model: model(), params, pollIntervalMs: 3000 });
    const opts = client.subscribe.mock.calls[0][2];
    // model fixture has mode: 'video' → 30 min default = 1_800_000 / 3000 = 600
    expect(opts).toEqual(expect.objectContaining({ intervalMs: 3000, maxAttempts: 600 }));
  });

  it('honors a caller-supplied pollTimeoutMs override', async () => {
    const client = ai([completed({ url: 'x', items: [] } as unknown as GenerateResult)]);
    await executeAsyncModel({
      ai: client,
      model: model(),
      params,
      pollIntervalMs: 3000,
      pollTimeoutMs: 45 * 60_000,
    });
    const opts = client.subscribe.mock.calls[0][2];
    expect(opts).toEqual(expect.objectContaining({ maxAttempts: 900 })); // 45 min / 3s
  });

  it('rethrows non-timeout errors unchanged', async () => {
    async function* boom(): AsyncGenerator<GenerationEvent, void, void> {
      yield progress();
      throw new Error('network down');
    }
    const client = {
      submit: vi.fn(async () => GENERATION_ID),
      subscribe: vi.fn(() => boom()),
    };
    await expect(executeAsyncModel({ ai: client, model: model(), params })).rejects.toThrow(/network down/);
  });
});

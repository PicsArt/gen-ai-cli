/**
 * Spec for execution/async.
 *
 * Contract:
 *   executeAsyncModel(ctx):
 *     - submits via ai.submit, then iterates ai.subscribe
 *     - emits onProgress for each status update
 *     - on 'COMPLETED' → calls ai.result, returns completed ExecutionResult
 *     - on 'FAILED'    → returns failed ExecutionResult with error
 *     - on abort signal → returns cancelled (no further work)
 *     - taskId is propagated from the handle id
 *     - returns 'failed' if subscription ends without terminal status
 */
import type {
  GenerateResult,
  GenerationContext,
  ModelDefinition,
  TypedModelId,
  WorkflowJobHandle,
} from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import { executeAsyncModel } from './async.ts';

interface StatusUpdate {
  status: string;
  progress?: { percent?: number };
  error?: string;
}

function model(): ModelDefinition {
  return { id: 'veo-3', name: 'Veo 3', mode: 'video' } as ModelDefinition;
}
const params: GenerationContext = { prompt: 'a sunset' } as GenerationContext;
const handle: WorkflowJobHandle = { id: 'job-123', workflow: 'wf' } as WorkflowJobHandle;

async function* yieldStatuses(updates: StatusUpdate[]): AsyncGenerator<StatusUpdate, StatusUpdate, void> {
  for (const u of updates) yield u;
  return updates[updates.length - 1];
}

function ai(updates: StatusUpdate[], result?: GenerateResult) {
  // Typed params document the SDK contract under test; vi.fn() infers
  // signatures from the wrapped callback. The args are unused at call
  // time — tests assert via toHaveBeenCalledWith, not by reading them.
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    submit: vi.fn(async (_id: TypedModelId, _ctx: GenerationContext) => handle),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    subscribe: vi.fn((_h: WorkflowJobHandle, _opts?: { intervalMs?: number; maxAttempts?: number }) =>
      yieldStatuses(updates),
    ),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    result: vi.fn(async (_h: WorkflowJobHandle, _id: TypedModelId) => result as GenerateResult),
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  COMPLETED                                                             */
/* ─────────────────────────────────────────────────────────────────────── */

describe('executeAsyncModel — COMPLETED', () => {
  it('returns completed with url + mapped results + taskId', async () => {
    const client = ai([{ status: 'IN_PROGRESS', progress: { percent: 50 } }, { status: 'COMPLETED' }], {
      url: 'https://x/v.mp4',
      results: [{ url: 'https://x/v.mp4' }],
    } as unknown as GenerateResult);
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('completed');
    expect(out.url).toBe('https://x/v.mp4');
    expect(out.results[0]?.type).toBe('video');
    expect(out.taskId).toBe('job-123');
    expect(client.submit).toHaveBeenCalledWith('veo-3', params);
    expect(client.result).toHaveBeenCalledWith(handle, 'veo-3');
  });

  it('emits onProgress for each status update with percent + elapsed', async () => {
    const client = ai(
      [
        { status: 'IN_PROGRESS', progress: { percent: 25 } },
        { status: 'IN_PROGRESS', progress: { percent: 75 } },
        { status: 'COMPLETED' },
      ],
      { url: 'x', results: [] } as unknown as GenerateResult,
    );
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
  it('returns failed with the error message from status', async () => {
    const client = ai([{ status: 'FAILED', error: 'workflow blew up' }]);
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('failed');
    expect(out.error).toBe('workflow blew up');
    expect(out.taskId).toBe('job-123');
  });

  it('uses fallback error text when status.error is empty', async () => {
    const client = ai([{ status: 'FAILED' }]);
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.error).toBe('Generation failed');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Cancellation                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('executeAsyncModel — cancellation', () => {
  it('returns cancelled when signal is aborted before terminal status', async () => {
    const controller = new AbortController();
    controller.abort(); // already aborted before subscribing
    const client = ai([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED' }]);
    const out = await executeAsyncModel({
      ai: client,
      model: model(),
      params,
      signal: controller.signal,
    });
    expect(out.status).toBe('cancelled');
    expect(out.taskId).toBe('job-123');
    expect(client.result).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Subscription ends without terminal                                    */
/* ─────────────────────────────────────────────────────────────────────── */

describe('executeAsyncModel — no terminal status', () => {
  it('returns failed when subscription drains without COMPLETED/FAILED', async () => {
    const client = ai([{ status: 'IN_PROGRESS' }, { status: 'IN_PROGRESS' }]);
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/terminal|ended/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  SDK timeout                                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('executeAsyncModel — SDK polling timeout', () => {
  it("returns 'timeout' status with taskId when SDK throws 'Timed out waiting for workflow' mid-stream", async () => {
    async function* timeoutAfterOne(): AsyncGenerator<StatusUpdate, StatusUpdate, void> {
      yield { status: 'IN_PROGRESS', progress: { percent: 10 } };
      throw new Error('Timed out waiting for workflow seedance:job-123');
    }
    const client = {
      submit: vi.fn(async () => handle),
      subscribe: vi.fn(() => timeoutAfterOne()),
      result: vi.fn(),
    };
    const out = await executeAsyncModel({ ai: client, model: model(), params });
    expect(out.status).toBe('timeout');
    expect(out.taskId).toBe('job-123');
    expect(out.error).toMatch(/still running/i);
    expect(client.result).not.toHaveBeenCalled();
  });

  it('passes maxAttempts derived from the model mode to subscribe', async () => {
    const client = ai([{ status: 'COMPLETED' }], { url: 'x', results: [] } as unknown as GenerateResult);
    await executeAsyncModel({ ai: client, model: model(), params, pollIntervalMs: 3000 });
    const opts = client.subscribe.mock.calls[0][1];
    // model fixture has mode: 'video' → 30 min default = 1_800_000 / 3000 = 600
    expect(opts).toEqual(expect.objectContaining({ intervalMs: 3000, maxAttempts: 600 }));
  });

  it('honors a caller-supplied pollTimeoutMs override', async () => {
    const client = ai([{ status: 'COMPLETED' }], { url: 'x', results: [] } as unknown as GenerateResult);
    await executeAsyncModel({
      ai: client,
      model: model(),
      params,
      pollIntervalMs: 3000,
      pollTimeoutMs: 45 * 60_000,
    });
    const opts = client.subscribe.mock.calls[0][1];
    expect(opts).toEqual(expect.objectContaining({ maxAttempts: 900 })); // 45 min / 3s
  });

  it('rethrows non-timeout errors unchanged', async () => {
    async function* boom(): AsyncGenerator<StatusUpdate, StatusUpdate, void> {
      yield { status: 'IN_PROGRESS' };
      throw new Error('network down');
    }
    const client = {
      submit: vi.fn(async () => handle),
      subscribe: vi.fn(() => boom()),
      result: vi.fn(),
    };
    await expect(executeAsyncModel({ ai: client, model: model(), params })).rejects.toThrow(/network down/);
  });
});

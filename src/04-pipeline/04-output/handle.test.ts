/**
 * Spec for output/handle.
 *
 * Contract:
 *   handleOutput(result, config, deps, driveCtx?):
 *     - calls the right display function based on result.status
 *     - downloads all result URLs when status=completed AND config.download
 *     - saves to Drive when status=completed AND config.driveSave AND driveCtx
 *     - splits multi-result Drive saves into one save per item
 *     - appends a history entry for every status (completed/failed/cancelled)
 *     - runs extras at the end
 *     - swallows download / Drive / history failures (non-critical)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const displayResultMock = vi.hoisted(() => vi.fn());
const displayFailedMock = vi.hoisted(() => vi.fn());
const displayCancelledMock = vi.hoisted(() => vi.fn());
const displayTimeoutMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn(async () => 'out-path'));
const saveToDriveMock = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));
const appendHistoryMock = vi.hoisted(() => vi.fn());
const runExtrasMock = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));

vi.mock('./display.ts', () => ({
  displayResult: displayResultMock,
  displayFailedResult: displayFailedMock,
  displayCancelledResult: displayCancelledMock,
  displayTimeoutResult: displayTimeoutMock,
}));
vi.mock('./download.ts', () => ({ downloadToDir: downloadMock }));
vi.mock('./drive.ts', () => ({ saveToDrive: saveToDriveMock }));
vi.mock('./extras.ts', () => ({ runExtras: runExtrasMock }));
vi.mock('#services/history.ts', () => ({ appendHistory: appendHistoryMock }));

import type { OutputDeps } from '#root/deps.ts';
import type { ExecutionResult, OutputConfig } from '#root/types.ts';
import type { DriveContext } from './drive.ts';
import { handleOutput } from './handle.ts';

beforeEach(() => {
  for (const m of [
    displayResultMock,
    displayFailedMock,
    displayCancelledMock,
    displayTimeoutMock,
    downloadMock,
    saveToDriveMock,
    appendHistoryMock,
    runExtrasMock,
  ])
    m.mockReset();
  downloadMock.mockResolvedValue('out-path');
  saveToDriveMock.mockResolvedValue(undefined);
  runExtrasMock.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

const deps = { out: { info: vi.fn(), success: vi.fn(), error: vi.fn() } } as unknown as OutputDeps;

function done(over: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    status: 'completed',
    url: 'https://example.com/a.png',
    results: [],
    model: { id: 'm', name: 'Model', mode: 'image' } as ExecutionResult['model'],
    params: { prompt: 'sunset' },
    durationMs: 1000,
    ...over,
  } as ExecutionResult;
}

const cfg = (over: Partial<OutputConfig> = {}): OutputConfig =>
  ({ download: '', driveSave: false, ...over }) as OutputConfig;

const driveCtx = {} as DriveContext;

/* ─────────────────────────────────────────────────────────────────────── */
/*  Display dispatch                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('handleOutput — display', () => {
  it('routes to displayResult on completed', async () => {
    await handleOutput(done(), cfg(), deps);
    expect(displayResultMock).toHaveBeenCalled();
  });

  it('routes to displayCancelledResult on cancelled', async () => {
    await handleOutput(done({ status: 'cancelled', url: undefined }), cfg(), deps);
    expect(displayCancelledMock).toHaveBeenCalled();
  });

  it('routes to displayFailedResult on failed', async () => {
    await handleOutput(done({ status: 'failed', error: 'boom', url: undefined }), cfg(), deps);
    expect(displayFailedMock).toHaveBeenCalled();
  });

  it('routes to displayTimeoutResult on timeout', async () => {
    await handleOutput(done({ status: 'timeout', taskId: 't-1', url: undefined }), cfg(), deps);
    expect(displayTimeoutMock).toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Download                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('handleOutput — download', () => {
  it('downloads when completed AND config.download is set', async () => {
    await handleOutput(done(), cfg({ download: './out' }), deps);
    expect(downloadMock).toHaveBeenCalledWith('https://example.com/a.png', './out', deps);
  });

  it('downloads every URL for multi-result generations', async () => {
    await handleOutput(
      done({
        results: [{ url: 'a.png' } as never, { url: 'b.png' } as never, { url: 'c.png' } as never],
      }),
      cfg({ download: './out' }),
      deps,
    );
    expect(downloadMock).toHaveBeenCalledTimes(3);
  });

  it('skips download when status is failed', async () => {
    await handleOutput(done({ status: 'failed', error: 'boom', url: undefined }), cfg({ download: './out' }), deps);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('swallows download errors and continues', async () => {
    downloadMock.mockRejectedValue(new Error('disk full'));
    await handleOutput(done(), cfg({ download: './out' }), deps);
    expect(deps.out.error).toHaveBeenCalledWith(expect.stringMatching(/Download failed/));
    expect(runExtrasMock).toHaveBeenCalled(); // continues to extras
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Drive save                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

describe('handleOutput — drive save', () => {
  it('saves when completed AND driveSave AND driveCtx', async () => {
    await handleOutput(done(), cfg({ driveSave: true }), deps, driveCtx);
    expect(saveToDriveMock).toHaveBeenCalledTimes(1);
  });

  it('skips when no driveCtx is provided', async () => {
    await handleOutput(done(), cfg({ driveSave: true }), deps);
    expect(saveToDriveMock).not.toHaveBeenCalled();
  });

  it('splits multi-result into one save per item', async () => {
    await handleOutput(
      done({
        results: [{ url: 'a.png' } as never, { url: 'b.png' } as never],
      }),
      cfg({ driveSave: true }),
      deps,
      driveCtx,
    );
    expect(saveToDriveMock).toHaveBeenCalledTimes(2);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  History + extras                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('handleOutput — history', () => {
  it('appends a history entry on completed (status=completed)', async () => {
    await handleOutput(done(), cfg(), deps);
    expect(appendHistoryMock).toHaveBeenCalledOnce();
    const [entry] = appendHistoryMock.mock.calls[0];
    expect((entry as { status: string }).status).toBe('completed');
  });

  it('records history on failure as status=failed', async () => {
    await handleOutput(done({ status: 'failed', error: 'boom', url: undefined }), cfg(), deps);
    const [entry] = appendHistoryMock.mock.calls[0];
    expect((entry as { status: string }).status).toBe('failed');
  });

  it('records history on cancellation as status=failed (per impl)', async () => {
    await handleOutput(done({ status: 'cancelled', url: undefined }), cfg(), deps);
    const [entry] = appendHistoryMock.mock.calls[0];
    expect((entry as { status: string }).status).toBe('failed');
  });

  it('records history on timeout as status=timeout', async () => {
    await handleOutput(done({ status: 'timeout', taskId: 't-1', url: undefined }), cfg(), deps);
    const [entry] = appendHistoryMock.mock.calls[0];
    expect((entry as { status: string }).status).toBe('timeout');
  });

  it('stores multiple resultUrls when results.length > 1', async () => {
    await handleOutput(
      done({
        results: [{ url: 'a.png' } as never, { url: 'b.png' } as never],
      }),
      cfg(),
      deps,
    );
    const [entry] = appendHistoryMock.mock.calls[0];
    expect((entry as { resultUrls?: string[] }).resultUrls).toEqual(['a.png', 'b.png']);
  });

  it('swallows history failure silently', async () => {
    appendHistoryMock.mockImplementation(() => {
      throw new Error('disk full');
    });
    await handleOutput(done(), cfg(), deps);
    expect(runExtrasMock).toHaveBeenCalled(); // continues to extras
  });
});

describe('handleOutput — extras', () => {
  it('always runs runExtras at the end', async () => {
    await handleOutput(done(), cfg(), deps);
    expect(runExtrasMock).toHaveBeenCalledTimes(1);
  });

  it('runs extras even on failure', async () => {
    await handleOutput(done({ status: 'failed', error: 'boom', url: undefined }), cfg(), deps);
    expect(runExtrasMock).toHaveBeenCalled();
  });
});

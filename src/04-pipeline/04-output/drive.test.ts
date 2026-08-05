/**
 * Spec for output/drive (Drive save orchestration).
 *
 * Contract:
 *   saveToDrive(result, driveCtx, deps):
 *     - no-op when status != 'completed' or no url
 *     - builds a smart filename via driveCtx.runCompletion (LLM)
 *     - builds Drive attributes from model + params
 *     - for video mode, attempts to capture a preview poster (best effort)
 *     - calls driveCtx.saveFn({ url, name, resourceType, attributes, folderUid, previewUrl })
 *     - logs info/success on success, error on failure (never throws)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./video-preview.ts', () => ({
  captureVideoPreview: vi.fn(async () => 'https://cdn/poster.jpg'),
}));

import type { OutputDeps } from '#root/deps.ts';
import type { ExecutionResult } from '#root/types.ts';
import { type DriveContext, saveToDrive } from './drive.ts';
import { captureVideoPreview } from './video-preview.ts';

function makeDeps() {
  const calls = { info: [] as string[], success: [] as string[], error: [] as string[] };
  return {
    calls,
    deps: {
      out: {
        info: (s: string) => calls.info.push(s),
        success: (s: string) => calls.success.push(s),
        error: (s: string) => calls.error.push(s),
        json: () => undefined,
        result: () => undefined,
      },
    } as unknown as OutputDeps,
  };
}

function makeDriveCtx() {
  const saveFn = vi.fn().mockResolvedValue('drive-uid-xyz');
  const runCompletion = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'golden hour' } }],
  });
  const ctx: DriveContext = {
    token: 't',
    uid: 'u',
    folderUid: 'folder-1',
    uploadUrl: 'https://upload.example.com',
    runCompletion,
    saveFn,
  };
  return { ctx, saveFn, runCompletion };
}

function done(over: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    status: 'completed',
    url: 'https://cdn/a.png',
    results: [],
    model: {
      id: 'flux-pro',
      name: 'Flux Pro',
      mode: 'image',
      inputType: 't2i',
      provider: 'picsart',
    } as ExecutionResult['model'],
    params: { prompt: 'a sunset' },
    durationMs: 1000,
    ...over,
  } as ExecutionResult;
}

beforeEach(() => {
  vi.mocked(captureVideoPreview).mockClear();
  vi.mocked(captureVideoPreview).mockResolvedValue('https://cdn/poster.jpg');
});
afterEach(() => vi.clearAllMocks());

/* ─────────────────────────────────────────────────────────────────────── */
/*  No-op paths                                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('saveToDrive — skip', () => {
  it('does nothing when status is failed', async () => {
    const { ctx, saveFn } = makeDriveCtx();
    const { deps } = makeDeps();
    await saveToDrive(done({ status: 'failed' }), ctx, deps);
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('does nothing when status is cancelled', async () => {
    const { ctx, saveFn } = makeDriveCtx();
    const { deps } = makeDeps();
    await saveToDrive(done({ status: 'cancelled' }), ctx, deps);
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('does nothing when there is no url', async () => {
    const { ctx, saveFn } = makeDriveCtx();
    const { deps } = makeDeps();
    await saveToDrive(done({ url: undefined }), ctx, deps);
    expect(saveFn).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Happy path                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

describe('saveToDrive — happy path', () => {
  it('calls saveFn with url, name, resourceType, attributes, folderUid', async () => {
    const { ctx, saveFn } = makeDriveCtx();
    const { deps } = makeDeps();
    await saveToDrive(done(), ctx, deps);
    expect(saveFn).toHaveBeenCalledOnce();
    const arg = saveFn.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.url).toBe('https://cdn/a.png');
    expect(typeof arg.name).toBe('string');
    expect(arg.folderUid).toBe('folder-1');
    expect(arg.attributes).toBeDefined();
  });

  it('uses the LLM to generate a smart filename', async () => {
    const { ctx, runCompletion, saveFn } = makeDriveCtx();
    const { deps } = makeDeps();
    await saveToDrive(done({ params: { prompt: 'a sunset' } }), ctx, deps);
    expect(runCompletion).toHaveBeenCalled();
    const name = (saveFn.mock.calls[0][0] as { name: string }).name;
    expect(name).toContain('golden-hour');
  });

  it('captures a poster preview when mode=video, passes previewUrl into saveFn', async () => {
    const { ctx, saveFn } = makeDriveCtx();
    const { deps } = makeDeps();
    await saveToDrive(
      done({
        url: 'https://cdn/clip.mp4',
        model: {
          mode: 'video',
          name: 'Veo',
          id: 'veo',
          inputType: 't2v',
          provider: 'google',
        } as ExecutionResult['model'],
      }),
      ctx,
      deps,
    );
    expect(captureVideoPreview).toHaveBeenCalledWith('https://cdn/clip.mp4', {
      token: 't',
      uid: 'u',
      uploadUrl: 'https://upload.example.com',
    });
    const arg = saveFn.mock.calls[0][0] as { previewUrl?: string };
    expect(arg.previewUrl).toBe('https://cdn/poster.jpg');
  });

  it('does NOT capture a preview for non-video modes', async () => {
    const { ctx } = makeDriveCtx();
    const { deps } = makeDeps();
    await saveToDrive(done(), ctx, deps);
    expect(captureVideoPreview).not.toHaveBeenCalled();
  });

  it('logs info before save and success after', async () => {
    const { ctx } = makeDriveCtx();
    const { calls, deps } = makeDeps();
    await saveToDrive(done(), ctx, deps);
    expect(calls.info[0]).toMatch(/Saving to Picsart Drive/);
    expect(calls.success[0]).toMatch(/Saved to Drive/);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Failure handling                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('saveToDrive — error handling', () => {
  it('logs error and does NOT throw when saveFn fails', async () => {
    const { ctx, saveFn } = makeDriveCtx();
    saveFn.mockRejectedValue(new Error('drive blew up'));
    const { calls, deps } = makeDeps();
    await expect(saveToDrive(done(), ctx, deps)).resolves.not.toThrow();
    expect(calls.error[0]).toContain('drive blew up');
  });
});

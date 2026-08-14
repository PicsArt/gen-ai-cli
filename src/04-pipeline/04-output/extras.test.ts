/**
 * Spec for output/extras.
 *
 * Contract:
 *   runExtras(result, config, deps):
 *     - on 'completed':
 *       - clipboard.copy is invoked iff config.clipboard AND clipboard succeeds
 *       - openInDefault is invoked iff config.open
 *       - bell() iff config.bell
 *       - sendNotification(...) iff config.notify
 *     - on 'failed' or 'cancelled':
 *       - clipboard / open are skipped
 *       - bell / notify still fire if requested
 *       - notification text differentiates failed vs cancelled
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clipboardMock = vi.hoisted(() => vi.fn());
const bellMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const notifyMock = vi.hoisted(() => vi.fn());
const previewMock = vi.hoisted(() => vi.fn());
const supportsInlineMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('#infra/utils/clipboard.ts', () => ({
  copyToClipboard: (...args: unknown[]) => clipboardMock(...args),
}));
vi.mock('#infra/utils/open.ts', () => ({
  bell: () => bellMock(),
  openInDefault: (...args: unknown[]) => openMock(...args),
  sendNotification: (...args: unknown[]) => notifyMock(...args),
}));
vi.mock('#infra/utils/terminal-image.ts', () => ({
  previewUrl: previewMock,
  supportsInlineImages: () => supportsInlineMock(),
}));

import type { OutputDeps } from '#root/deps.ts';
import type { ExecutionResult, OutputConfig } from '#root/types.ts';
import { runExtras } from './extras.ts';

beforeEach(() => {
  clipboardMock.mockReset();
  bellMock.mockReset();
  openMock.mockReset();
  notifyMock.mockReset();
  previewMock.mockReset();
  supportsInlineMock.mockReset();
  supportsInlineMock.mockReturnValue(false);
});
afterEach(() => vi.clearAllMocks());

function done(over: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    status: 'completed',
    url: 'https://example.com/out.png',
    model: { id: 'm', name: 'Model', mode: 'image' } as ExecutionResult['model'],
    params: {},
    durationMs: 1000,
    ...over,
  } as ExecutionResult;
}

function cfg(over: Partial<OutputConfig> = {}): OutputConfig {
  return {
    clipboard: false,
    open: false,
    bell: false,
    notify: false,
    ...over,
  } as OutputConfig;
}

const deps = { out: { info: vi.fn(), success: vi.fn(), error: vi.fn() } } as unknown as OutputDeps;

/* ─────────────────────────────────────────────────────────────────────── */
/*  completed path                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('runExtras — completed', () => {
  it('clipboard fires iff config.clipboard AND copy succeeds', async () => {
    clipboardMock.mockReturnValue(true);
    await runExtras(done(), cfg({ clipboard: true }), deps);
    expect(clipboardMock).toHaveBeenCalledWith('https://example.com/out.png');
  });

  it('does not announce clipboard success when copy returns false', async () => {
    clipboardMock.mockReturnValue(false);
    await runExtras(done(), cfg({ clipboard: true }), deps);
    expect(deps.out.info).not.toHaveBeenCalledWith(expect.stringMatching(/clipboard/i));
  });

  it('opens in default app iff config.open', async () => {
    await runExtras(done(), cfg({ open: true }), deps);
    expect(openMock).toHaveBeenCalledWith('https://example.com/out.png');

    openMock.mockReset();
    await runExtras(done(), cfg({ open: false }), deps);
    expect(openMock).not.toHaveBeenCalled();
  });

  it('rings the bell iff config.bell', async () => {
    await runExtras(done(), cfg({ bell: true }), deps);
    expect(bellMock).toHaveBeenCalled();
  });

  it('notifies with "complete" message iff config.notify', async () => {
    await runExtras(done(), cfg({ notify: true }), deps);
    expect(notifyMock).toHaveBeenCalledWith('gen-ai', expect.stringMatching(/complete/i));
  });

  it('previews inline iff mode=image and terminal supports it', async () => {
    supportsInlineMock.mockReturnValue(true);
    await runExtras(done({ model: { mode: 'image' } as ExecutionResult['model'] }), cfg(), deps);
    expect(previewMock).toHaveBeenCalled();

    previewMock.mockReset();
    await runExtras(done({ model: { mode: 'video' } as ExecutionResult['model'] }), cfg(), deps);
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('`config set imagePreview false` disables the inline preview even when the terminal supports it', async () => {
    supportsInlineMock.mockReturnValue(true);
    await runExtras(done({ model: { mode: 'image' } as ExecutionResult['model'] }), cfg({ imagePreview: false }), deps);
    expect(previewMock).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  failed / cancelled path                                               */
/* ─────────────────────────────────────────────────────────────────────── */

describe('runExtras — failure paths', () => {
  it('skips clipboard and open when status is failed', async () => {
    await runExtras(
      { status: 'failed', error: 'boom', model: { mode: 'image' } } as ExecutionResult,
      cfg({ clipboard: true, open: true }),
      deps,
    );
    expect(clipboardMock).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });

  it('still rings bell on failure if requested', async () => {
    await runExtras({ status: 'failed', error: 'boom' } as ExecutionResult, cfg({ bell: true }), deps);
    expect(bellMock).toHaveBeenCalled();
  });

  it('notification text differentiates failed vs cancelled', async () => {
    await runExtras({ status: 'failed', error: 'boom' } as ExecutionResult, cfg({ notify: true }), deps);
    expect(notifyMock).toHaveBeenLastCalledWith('gen-ai', expect.stringMatching(/failed/i));

    notifyMock.mockReset();
    await runExtras({ status: 'cancelled' } as ExecutionResult, cfg({ notify: true }), deps);
    expect(notifyMock).toHaveBeenLastCalledWith('gen-ai', expect.stringMatching(/cancelled/i));
  });

  it('notification text for timeout mentions the task id', async () => {
    await runExtras({ status: 'timeout', taskId: 't-1' } as ExecutionResult, cfg({ notify: true }), deps);
    expect(notifyMock).toHaveBeenLastCalledWith('gen-ai', expect.stringMatching(/still running/i));
    expect(notifyMock).toHaveBeenLastCalledWith('gen-ai', expect.stringContaining('t-1'));
  });
});

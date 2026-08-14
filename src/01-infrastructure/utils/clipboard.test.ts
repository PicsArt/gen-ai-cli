/**
 * Clipboard utilities — platform command wiring and fallback chains,
 * with child_process fully mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

import fs from 'node:fs';
import { copyToClipboard, extractClipboardImage, hasClipboardImage, readClipboardText } from './clipboard.ts';

const originalPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  spawnSyncMock.mockReset();
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe('copyToClipboard', () => {
  it('uses pbcopy on macOS and reports success', () => {
    setPlatform('darwin');
    spawnSyncMock.mockReturnValue({ status: 0 });
    expect(copyToClipboard('hello')).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith('pbcopy', [], expect.objectContaining({ input: 'hello' }));
  });

  it('reports failure when pbcopy exits non-zero', () => {
    setPlatform('darwin');
    spawnSyncMock.mockReturnValue({ status: 1 });
    expect(copyToClipboard('hello')).toBe(false);
  });

  it('falls back from xclip to xsel on Linux', () => {
    setPlatform('linux');
    spawnSyncMock
      .mockReturnValueOnce({ status: null, error: new Error('ENOENT') }) // xclip missing
      .mockReturnValueOnce({ status: 0 }); // xsel works
    expect(copyToClipboard('text')).toBe(true);
    expect(spawnSyncMock.mock.calls[0][0]).toBe('xclip');
    expect(spawnSyncMock.mock.calls[1][0]).toBe('xsel');
  });

  it('returns false when both Linux tools fail', () => {
    setPlatform('linux');
    spawnSyncMock.mockReturnValue({ status: 1 });
    expect(copyToClipboard('text')).toBe(false);
  });
});

describe('hasClipboardImage', () => {
  it('detects PNG data on macOS via clipboard info', () => {
    setPlatform('darwin');
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '«class PNGf», 12345' });
    expect(hasClipboardImage()).toBe(true);
  });

  it('returns false when macOS clipboard has no image class', () => {
    setPlatform('darwin');
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'string, 42' });
    expect(hasClipboardImage()).toBe(false);
  });

  it('checks xclip TARGETS on Linux', () => {
    setPlatform('linux');
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'TARGETS\nimage/png\ntext/plain' });
    expect(hasClipboardImage()).toBe(true);
  });

  it('returns false when stdout is missing entirely', () => {
    setPlatform('linux');
    spawnSyncMock.mockReturnValue({ status: null, error: new Error('ENOENT') });
    expect(hasClipboardImage()).toBe(false);
  });
});

describe('readClipboardText', () => {
  it('returns trimmed pbpaste output on macOS', () => {
    setPlatform('darwin');
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '  copied text \n' });
    expect(readClipboardText()).toBe('copied text');
  });

  it('returns null for an empty clipboard', () => {
    setPlatform('darwin');
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '' });
    expect(readClipboardText()).toBe(null);
  });

  it('falls back from xclip to xsel on Linux', () => {
    setPlatform('linux');
    spawnSyncMock
      .mockReturnValueOnce({ status: 1, stdout: '' }) // xclip failed
      .mockReturnValueOnce({ status: 0, stdout: 'from-xsel' });
    expect(readClipboardText()).toBe('from-xsel');
  });
});

describe('extractClipboardImage', () => {
  it('writes the xclip PNG bytes to a temp file on Linux', () => {
    setPlatform('linux');
    spawnSyncMock.mockReturnValue({ status: 0, stdout: Buffer.from('png-bytes') });
    const file = extractClipboardImage();
    expect(file).not.toBe(null);
    expect(fs.readFileSync(file as string, 'utf-8')).toBe('png-bytes');
    fs.rmSync(file as string, { force: true });
  });

  it('returns null and leaves no temp file when extraction fails on macOS', () => {
    setPlatform('darwin');
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '' }); // osascript AND pngpaste fail
    expect(extractClipboardImage()).toBe(null);
  });

  it('returns null when xclip produces no data on Linux', () => {
    setPlatform('linux');
    spawnSyncMock.mockReturnValue({ status: 0, stdout: Buffer.alloc(0) });
    expect(extractClipboardImage()).toBe(null);
  });
});

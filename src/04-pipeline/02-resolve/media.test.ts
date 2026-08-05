/**
 * Spec for resolve/media.
 *
 * Contract:
 *   resolveGenerationInputs(ctx, opts):
 *     - mutates ctx in place
 *     - imageUrls: uploads local paths, passes URLs through, sets [] inputs → undefined
 *     - videoUrl: same treatment
 *     - audioUrl: same treatment
 *     - calls getOutput().info(...) when a local file is uploaded
 *     - skips upload when the value is already a URL
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadFileMock = vi.hoisted(() => vi.fn());
const isLocalFileMock = vi.hoisted(() => vi.fn());

vi.mock('#services/file-upload.ts', () => ({
  uploadFile: uploadFileMock,
  isLocalFile: isLocalFileMock,
}));

// Initialize output singleton so getOutput().info doesn't crash
import { createColorManager } from '#infra/ui-core/color.ts';
import { createOutputManager } from '#infra/ui-core/output.ts';

createOutputManager({
  color: createColorManager({ enabled: false }),
  quiet: true,
  debug: false,
  jsonMode: false,
  plainMode: false,
});

import { resolveGenerationInputs } from './media.ts';

const opts = { token: 't', uid: 'u' };

beforeEach(() => {
  uploadFileMock.mockReset();
  isLocalFileMock.mockReset();
  uploadFileMock.mockImplementation(async (p: string) => `https://cdn/${p}`);
});
afterEach(() => vi.clearAllMocks());

describe('resolveGenerationInputs — imageUrls', () => {
  it('uploads local paths', async () => {
    isLocalFileMock.mockReturnValue(true);
    const ctx = { imageUrls: ['/local/a.png', '/local/b.png'] };
    await resolveGenerationInputs(ctx, opts);
    expect(uploadFileMock).toHaveBeenCalledTimes(2);
    expect(ctx.imageUrls).toEqual(['https://cdn//local/a.png', 'https://cdn//local/b.png']);
  });

  it('passes through URLs unchanged', async () => {
    isLocalFileMock.mockReturnValue(false);
    const ctx = { imageUrls: ['https://example.com/a.png'] };
    await resolveGenerationInputs(ctx, opts);
    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(ctx.imageUrls).toEqual(['https://example.com/a.png']);
  });

  it('sets imageUrls to undefined when array is empty', async () => {
    const ctx: { imageUrls?: string[] } = { imageUrls: [] };
    await resolveGenerationInputs(ctx, opts);
    expect(ctx.imageUrls).toBeUndefined();
  });

  it('trims whitespace from URLs and drops empties', async () => {
    isLocalFileMock.mockReturnValue(false);
    const ctx = { imageUrls: [' https://x/a.png ', '', '  '] };
    await resolveGenerationInputs(ctx, opts);
    expect(ctx.imageUrls).toEqual(['https://x/a.png']);
  });
});

describe('resolveGenerationInputs — videoUrl', () => {
  it('uploads a local path', async () => {
    isLocalFileMock.mockReturnValue(true);
    const ctx = { videoUrl: '/local/clip.mp4' };
    await resolveGenerationInputs(ctx, opts);
    expect(ctx.videoUrl).toBe('https://cdn//local/clip.mp4');
  });

  it('passes through a URL', async () => {
    isLocalFileMock.mockReturnValue(false);
    const ctx = { videoUrl: 'https://x/v.mp4' };
    await resolveGenerationInputs(ctx, opts);
    expect(ctx.videoUrl).toBe('https://x/v.mp4');
  });

  it('clears empty string to undefined', async () => {
    const ctx: { videoUrl?: string } = { videoUrl: '   ' };
    await resolveGenerationInputs(ctx, opts);
    expect(ctx.videoUrl).toBeUndefined();
  });
});

describe('resolveGenerationInputs — audioUrl', () => {
  it('uploads a local path', async () => {
    isLocalFileMock.mockReturnValue(true);
    const ctx = { audioUrl: '/local/voice.mp3' };
    await resolveGenerationInputs(ctx, opts);
    expect(ctx.audioUrl).toBe('https://cdn//local/voice.mp3');
  });

  it('clears empty string to undefined', async () => {
    const ctx: { audioUrl?: string } = { audioUrl: '' };
    await resolveGenerationInputs(ctx, opts);
    expect(ctx.audioUrl).toBeUndefined();
  });
});

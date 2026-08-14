/**
 * Spec for output/download.
 *
 * Contract:
 *   downloadToDir(url, dir, deps):
 *     - creates `dir` if it doesn't exist
 *     - derives the filename from the URL's pathname (basename)
 *     - sanitizes filesystem-unsafe characters from the filename
 *     - falls back to 'output' when basename is empty
 *     - writes the body to <dir>/<filename>
 *     - returns the absolute output path
 *     - throws on non-2xx HTTP response
 *     - expands ~ in dir via resolveUserPath
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputDeps } from '#root/deps.ts';
import { downloadToDir } from './download.ts';

let tmpDir: string;
let originalFetch: typeof fetch;
const deps = { out: { info: vi.fn(), success: vi.fn(), error: vi.fn() } } as unknown as OutputDeps;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('downloadToDir', () => {
  it('writes the body to <dir>/<basename> and returns the path', async () => {
    globalThis.fetch = vi.fn(async () => new Response('binary-content', { status: 200 })) as unknown as typeof fetch;
    const out = await downloadToDir('https://example.com/files/photo.png', tmpDir, deps);
    expect(out).toBe(path.join(tmpDir, 'photo.png'));
    expect(fs.readFileSync(out, 'utf-8')).toBe('binary-content');
  });

  it('creates the directory if it does not exist', async () => {
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200 })) as unknown as typeof fetch;
    const sub = path.join(tmpDir, 'newdir', 'nested');
    expect(fs.existsSync(sub)).toBe(false);
    await downloadToDir('https://example.com/a.png', sub, deps);
    expect(fs.existsSync(sub)).toBe(true);
  });

  it('falls back to "output" when URL path has no basename', async () => {
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200 })) as unknown as typeof fetch;
    const out = await downloadToDir('https://example.com/', tmpDir, deps);
    expect(path.basename(out)).toBe('output');
  });

  it('sanitizes unsafe characters in the filename', async () => {
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200 })) as unknown as typeof fetch;
    const out = await downloadToDir('https://example.com/bad%3Cname%3E.png', tmpDir, deps);
    const filename = path.basename(out);
    // < and > should be stripped/replaced — assert no raw "<" or ">" or other unsafe chars
    expect(/[<>:"|?*]/.test(filename)).toBe(false);
  });

  it('throws on HTTP non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch;
    await expect(downloadToDir('https://example.com/x.png', tmpDir, deps)).rejects.toThrow(/404/);
  });

  it('logs info before fetch and success after write', async () => {
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200 })) as unknown as typeof fetch;
    await downloadToDir('https://example.com/a.png', tmpDir, deps);
    expect(deps.out.info).toHaveBeenCalledWith(expect.stringMatching(/Downloading/));
    expect(deps.out.success).toHaveBeenCalledWith(expect.stringMatching(/Saved/));
  });

  // Multi-result generations (and re-runs into the same dir) often share a
  // URL basename — the second download must not clobber the first.
  it('does not overwrite an existing file with the same basename', async () => {
    let body = 0;
    globalThis.fetch = vi.fn(async () => new Response(`content-${++body}`, { status: 200 })) as unknown as typeof fetch;

    const first = await downloadToDir('https://example.com/a/photo.png', tmpDir, deps);
    const second = await downloadToDir('https://example.com/b/photo.png', tmpDir, deps);

    expect(second).not.toBe(first);
    expect(fs.readFileSync(first, 'utf-8')).toBe('content-1');
    expect(fs.readFileSync(second, 'utf-8')).toBe('content-2');
  });

  it('keeps the extension when de-duplicating filenames', async () => {
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200 })) as unknown as typeof fetch;
    await downloadToDir('https://example.com/a/photo.png', tmpDir, deps);
    const second = await downloadToDir('https://example.com/b/photo.png', tmpDir, deps);
    expect(path.extname(second)).toBe('.png');
  });

  it('expands ~ in the destination directory', async () => {
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200 })) as unknown as typeof fetch;
    // Set HOME → tmpDir so "~/sub" resolves under tmp
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    try {
      const out = await downloadToDir('https://example.com/a.png', '~/sub', deps);
      expect(out.startsWith(tmpDir)).toBe(true);
      expect(out).toContain('sub');
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      else delete process.env.HOME;
    }
  });
});

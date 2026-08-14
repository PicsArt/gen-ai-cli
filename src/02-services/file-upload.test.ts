/**
 * Spec for the file-upload service.
 *
 * Contract:
 *   isLocalFile(input):
 *     - http:// and https:// URLs are NOT local
 *     - existing filesystem path is local
 *     - non-existent path is not local
 *
 *   uploadFile(path, opts):
 *     - POSTs the file to the upload URL with auth headers
 *     - Returns the response URL on success
 *     - Throws on HTTP failure
 *     - Throws if the file exceeds 500MB
 *     - Throws if the response has no URL
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileError } from '#infra/errors/file.ts';
import { isLocalFile, resolveFileInput, uploadFile } from './file-upload.ts';

let tmpDir: string;
let originalFetch: typeof fetch;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-upload-'));
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  isLocalFile                                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('isLocalFile', () => {
  it('returns false for http:// URLs', () => {
    expect(isLocalFile('http://example.com/img.png')).toBe(false);
  });

  it('returns false for https:// URLs', () => {
    expect(isLocalFile('https://example.com/img.png')).toBe(false);
  });

  it('returns true for an existing local file', () => {
    const filePath = path.join(tmpDir, 'real.png');
    fs.writeFileSync(filePath, 'data');
    expect(isLocalFile(filePath)).toBe(true);
  });

  it('returns false for a non-existent local path', () => {
    expect(isLocalFile(path.join(tmpDir, 'ghost.png'))).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  uploadFile — happy path                                               */
/* ─────────────────────────────────────────────────────────────────────── */

describe('uploadFile — happy path', () => {
  it('posts the file and returns the response URL', async () => {
    const filePath = path.join(tmpDir, 'photo.png');
    fs.writeFileSync(filePath, 'fake-png-bytes');

    const mock = vi.fn(async () => {
      return new Response(JSON.stringify({ response: { url: 'https://cdn.example.com/uploaded.png' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = mock as unknown as typeof fetch;

    const url = await uploadFile(filePath, { token: 'tkn', uid: 'usr' });
    expect(url).toBe('https://cdn.example.com/uploaded.png');
    expect(mock).toHaveBeenCalledOnce();
  });

  it('accepts a response with top-level "url" field (legacy shape)', async () => {
    const filePath = path.join(tmpDir, 'a.png');
    fs.writeFileSync(filePath, 'x');

    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ url: 'https://cdn.example.com/legacy.png' }), { status: 200 }),
    ) as unknown as typeof fetch;

    expect(await uploadFile(filePath, { token: 't', uid: 'u' })).toBe('https://cdn.example.com/legacy.png');
  });

  it('sends Authorization Bearer header from opts.token', async () => {
    const filePath = path.join(tmpDir, 'a.png');
    fs.writeFileSync(filePath, 'x');

    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ url: 'https://x' }), { status: 200 });
    }) as unknown as typeof fetch;

    await uploadFile(filePath, { token: 'my-token', uid: 'usr-99' });
    expect(capturedHeaders.Authorization).toBe('Bearer my-token');
    expect(capturedHeaders['user-id']).toBe('usr-99');
  });

  it.each([
    ['photo.heic', 'image/heic'],
    ['photo.avif', 'image/avif'],
    ['clip.mov', 'video/quicktime'],
    ['take.m4a', 'audio/mp4'],
    ['legacy.png', 'image/png'],
    ['mystery.xyz', 'application/octet-stream'],
  ])('uploading %s sends Content-Type %s', async (filename, expectedType) => {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, 'x');

    let capturedType: string | undefined;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body as FormData;
      capturedType = (body.get('file') as File | Blob | null)?.type;
      return new Response(JSON.stringify({ url: 'https://x' }), { status: 200 });
    }) as unknown as typeof fetch;

    await uploadFile(filePath, { token: 't', uid: 'u' });
    expect(capturedType).toBe(expectedType);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  uploadFile — error paths                                              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('uploadFile — error paths', () => {
  it('throws on HTTP non-2xx with status code in the message', async () => {
    const filePath = path.join(tmpDir, 'a.png');
    fs.writeFileSync(filePath, 'x');

    globalThis.fetch = vi.fn(
      async () => new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    ) as unknown as typeof fetch;

    await expect(uploadFile(filePath, { token: 't', uid: 'u' })).rejects.toThrow(/401/);
  });

  it('throws if the response is missing a URL', async () => {
    const filePath = path.join(tmpDir, 'a.png');
    fs.writeFileSync(filePath, 'x');

    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ response: {} }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(uploadFile(filePath, { token: 't', uid: 'u' })).rejects.toThrow(/no url/i);
  });

  it('throws when the file is missing', async () => {
    const filePath = path.join(tmpDir, 'ghost.png');
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    await expect(uploadFile(filePath, { token: 't', uid: 'u' })).rejects.toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  resolveFileInput — bad input rejection                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('uploadFile — transport failures', () => {
  it('surfaces a NetworkError (exit 4) when the POST never reaches the server', async () => {
    const filePath = path.join(tmpDir, 'net.png');
    fs.writeFileSync(filePath, 'data');
    globalThis.fetch = (() => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;

    const { NetworkError } = await import('#infra/errors/network.ts');
    const err = await uploadFile(filePath, { token: 't', uid: 'u' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NetworkError);
  });
});

describe('resolveAllFiles', () => {
  it('passes URLs through every slot without uploading', async () => {
    const { resolveAllFiles } = await import('./file-upload.ts');
    globalThis.fetch = vi.fn() as unknown as typeof fetch; // any call would be a bug

    const url = 'https://example.com/a.png';
    const resolved = await resolveAllFiles(
      {
        images: [url, url],
        startFrame: url,
        endFrame: url,
        video: url,
        audio: url,
        staticMask: url,
        sceneImage: url,
        styleImage: url,
      },
      { token: 't', uid: 'u' },
    );

    expect(resolved.images).toEqual([url, url]);
    expect(resolved.startFrame).toBe(url);
    expect(resolved.styleImage).toBe(url);
    expect(resolved.videos).toBeUndefined(); // empty slots stay undefined
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('resolveAllFiles — concurrency', () => {
  it('uploads multiple local files concurrently, preserving order', async () => {
    const { resolveAllFiles } = await import('./file-upload.ts');
    const fileA = path.join(tmpDir, 'a.png');
    const fileB = path.join(tmpDir, 'b.png');
    fs.writeFileSync(fileA, 'aaa');
    fs.writeFileSync(fileB, 'bbb');

    // Each upload resolves only after BOTH requests are in flight — a serial
    // implementation would deadlock here (and hit the test timeout).
    let inFlight = 0;
    let bothStarted: () => void;
    const gate = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      inFlight++;
      if (inFlight === 2) bothStarted();
      await gate;
      const name = ((init?.body as FormData).get('file') as File).name;
      return new Response(JSON.stringify({ url: `https://cdn.example.com/${name}` }), { status: 200 });
    }) as unknown as typeof fetch;

    const resolved = await resolveAllFiles({ images: [fileA, fileB] }, { token: 't', uid: 'u' });
    expect(resolved.images).toEqual(['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png']);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('uploadFile — directory inputs', () => {
  it('throws a clean FileError for a directory instead of a raw EISDIR', async () => {
    const err = await uploadFile(tmpDir, { token: 't', uid: 'u' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FileError);
    expect((err as FileError).friendlyMessage).toMatch(/directory/i);
  });

  it('throws FileError (not a raw ENOENT) when the file vanishes before upload', async () => {
    const err = await uploadFile(path.join(tmpDir, 'gone.png'), { token: 't', uid: 'u' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FileError);
  });

  it('resolveFileInput routes a directory into the same clean FileError', async () => {
    const err = await resolveFileInput(tmpDir, { token: 't', uid: 'u' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FileError);
  });
});

describe('resolveFileInput', () => {
  it('throws FileError for a path-shaped string with no file on disk', async () => {
    // Reproduces the voice-clone failure: AUD=/voice.mp3 (non-existent),
    // which used to be shipped to the backend as a URL.
    await expect(resolveFileInput('/voice.mp3', { token: 't', uid: 'u' })).rejects.toBeInstanceOf(FileError);
  });

  it('passes through http(s) URLs unchanged without an upload', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const url = 'https://example.com/clip.mp3';
    await expect(resolveFileInput(url, { token: 't', uid: 'u' })).resolves.toBe(url);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

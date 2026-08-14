/**
 * Binary-mode self-update — download + checksum verification branches,
 * exercised with fetch mocked and GEN_AI_OCLIF_ROOT forcing binary mode.
 * The flow is always stopped at the checksum gate (mismatching hashes for
 * every platform label), so the running executable is never touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performUpdate } from './self-update.ts';

const realFetch = globalThis.fetch;
let originalOclifRoot: string | undefined;
let originalExecPathDesc: PropertyDescriptor;
let tmpBinDir: string;
let fakeExecPath: string;

// Every platform label the updater can derive, all pointing at a hash the
// downloaded payload will never match.
const MISMATCH_CHECKSUMS = [
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-x64-musl',
  'linux-arm64',
  'linux-arm64-musl',
]
  .map((p) => `${'0'.repeat(64)}  gen-ai-${p}`)
  .concat(`${'0'.repeat(64)}  gen-ai-windows-x64.exe`)
  .join('\n');

beforeEach(() => {
  originalOclifRoot = process.env.GEN_AI_OCLIF_ROOT;
  process.env.GEN_AI_OCLIF_ROOT = '/opt/gen-ai'; // force binary install mode
  // Point execPath into a temp dir so the updater stages (and cleans) its
  // .new file there — never next to the real running binary.
  tmpBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-selfupd-'));
  fakeExecPath = path.join(tmpBinDir, 'gen-ai');
  fs.writeFileSync(fakeExecPath, 'old-binary');
  originalExecPathDesc = Object.getOwnPropertyDescriptor(process, 'execPath') as PropertyDescriptor;
  Object.defineProperty(process, 'execPath', { value: fakeExecPath, configurable: true });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (originalOclifRoot !== undefined) process.env.GEN_AI_OCLIF_ROOT = originalOclifRoot;
  else delete process.env.GEN_AI_OCLIF_ROOT;
  Object.defineProperty(process, 'execPath', originalExecPathDesc);
  fs.rmSync(tmpBinDir, { recursive: true, force: true });
});

describe('performUpdate — binary mode', () => {
  it('reports a friendly message when the release server is unreachable', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const result = await performUpdate({ currentVersion: '1.0.0' });
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/release server|network/i);
  });

  it('treats a non-version latest.txt body (captive portal HTML) as unreachable', async () => {
    // A 200 + HTML answer must not be compared as a version — and with
    // --force it must never be spliced into the download URL.
    const fetchMock = vi.fn(
      async () => new Response('<!DOCTYPE html><html>hotel wifi login</html>', { status: 200 }),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    globalThis.fetch = fetchMock;

    const result = await performUpdate({ currentVersion: '1.0.0', force: true });
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/release server|network/i);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never proceeded to a download
  });

  it('reports already-up-to-date without downloading anything', async () => {
    const fetchMock = vi.fn(async () => new Response('1.0.0\n', { status: 200 })) as unknown as typeof fetch &
      ReturnType<typeof vi.fn>;
    globalThis.fetch = fetchMock;
    const result = await performUpdate({ currentVersion: '1.0.0' });
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/up to date/i);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only latest.txt
  });

  it('rejects a download whose checksum does not match and leaves no staged file', async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('latest.txt')) return new Response('99.0.0\n', { status: 200 });
      if (u.endsWith('checksums.txt')) return new Response(MISMATCH_CHECKSUMS, { status: 200 });
      return new Response('definitely-not-the-right-bytes', { status: 200 });
    }) as unknown as typeof fetch;

    const result = await performUpdate({ currentVersion: '1.0.0' });
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/checksum mismatch/i);

    expect(fs.existsSync(`${fakeExecPath}.new`)).toBe(false);
  });

  it('downloads, verifies, and swaps the binary when the checksum matches', async () => {
    const crypto = await import('node:crypto');
    const payload = 'brand-new-binary-bytes';
    const goodHash = crypto.createHash('sha256').update(payload).digest('hex');
    const allPlatforms = [
      'darwin-x64',
      'darwin-arm64',
      'linux-x64',
      'linux-x64-musl',
      'linux-arm64',
      'linux-arm64-musl',
    ]
      .map((p) => `${goodHash}  gen-ai-${p}`)
      .concat(`${goodHash}  gen-ai-windows-x64.exe`)
      .join('\n');

    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('latest.txt')) return new Response('99.0.0\n', { status: 200 });
      if (u.endsWith('checksums.txt')) return new Response(allPlatforms, { status: 200 });
      return new Response(payload, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await performUpdate({ currentVersion: '1.0.0' });
    expect(result.updated).toBe(true);
    expect(result.newVersion).toBe('99.0.0');
    // The staged file replaced the (fake) running binary atomically.
    expect(fs.readFileSync(fakeExecPath, 'utf-8')).toBe(payload);
    expect(fs.existsSync(`${fakeExecPath}.new`)).toBe(false);
  });

  it('fails cleanly when the checksum for this platform is missing entirely', async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('latest.txt')) return new Response('99.0.0\n', { status: 200 });
      if (u.endsWith('checksums.txt')) return new Response('', { status: 200 });
      return new Response('payload', { status: 200 });
    }) as unknown as typeof fetch;

    const result = await performUpdate({ currentVersion: '1.0.0' });
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/checksum/i);

    expect(fs.existsSync(`${fakeExecPath}.new`)).toBe(false);
  });
});

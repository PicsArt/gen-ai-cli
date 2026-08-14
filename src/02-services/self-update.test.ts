/**
 * Spec for self-update.
 *
 * Heavy integration code (downloads binaries, spawns npm). Tests here are
 * limited to the public contract surface — full integration tests live
 * outside the unit suite.
 *
 * Contract:
 *   performUpdate(opts):
 *     - returns an UpdateResult shape { updated, oldVersion, newVersion, message }
 *     - oldVersion echoes opts.currentVersion when provided
 *     - returns { updated: false } when the network check fails (no throw)
 */
import { describe, expect, it, vi } from 'vitest';
import { findChecksum, performUpdate, type UpdateResult } from './self-update.ts';

describe('findChecksum — exact platform match (no glibc/musl substring collision)', () => {
  // checksums.txt lists glibc before musl, and "gen-ai-linux-x64" is a prefix
  // of "gen-ai-linux-x64-musl" — a substring match would pick the wrong hash.
  const checksums = [
    'aaaaaaaa  gen-ai-darwin-arm64',
    'bbbbbbbb  gen-ai-linux-x64',
    'cccccccc  gen-ai-linux-x64-musl',
    'dddddddd  gen-ai-linux-arm64',
    'eeeeeeee  gen-ai-linux-arm64-musl',
  ].join('\n');

  it('picks the glibc hash for linux-x64, not the musl line', () => {
    expect(findChecksum(checksums, 'linux-x64')).toBe('bbbbbbbb');
  });

  it('picks the musl hash for linux-x64-musl', () => {
    expect(findChecksum(checksums, 'linux-x64-musl')).toBe('cccccccc');
  });

  it('picks the glibc hash for linux-arm64, not the musl line', () => {
    expect(findChecksum(checksums, 'linux-arm64')).toBe('dddddddd');
  });

  it('returns undefined when the platform is absent', () => {
    expect(findChecksum(checksums, 'windows-x64', '.exe')).toBeUndefined();
  });
});

describe('performUpdate — dev-clone guard', () => {
  it('refuses to update when running from a source tree', async () => {
    // A dev clone has no install to update — `npm install -g` would create or
    // overwrite the developer's GLOBAL install, and CLI_VERSION (0.0.0-dev)
    // means the "already up to date" exit would never fire. The updater must
    // refuse without touching the network or spawning npm.
    const orig = globalThis.fetch;
    const fetchSpy = vi.fn(async () => new Response('', { status: 500 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const result = await performUpdate({ currentVersion: '0.0.0-dev', fromSource: true });
      expect(result.updated).toBe(false);
      expect(result.message).toMatch(/dev clone/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('defaults fromSource to real detection — true in this test environment (a repo checkout)', async () => {
    // The vitest run itself executes from the source tree, so the default
    // detection must trip the guard without any override.
    const result = await performUpdate({ currentVersion: '1.0.0' });
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/dev clone/i);
  });
});

describe('performUpdate — shape', () => {
  it('returns an UpdateResult object', async () => {
    // Block all network fetches → the updater should fail gracefully and
    // return { updated: false } rather than throwing.
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    try {
      const result: UpdateResult = await performUpdate({ currentVersion: '1.0.0', fromSource: false });
      expect(typeof result.updated).toBe('boolean');
      expect(typeof result.oldVersion).toBe('string');
      expect(typeof result.newVersion).toBe('string');
      expect(typeof result.message).toBe('string');
      expect(result.oldVersion).toBe('1.0.0');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('returns updated: false when the network check fails', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    try {
      const result = await performUpdate({ currentVersion: '1.0.0', fromSource: false });
      expect(result.updated).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('returns updated: false when already on the latest version', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ version: '1.0.0' }), { status: 200 }),
    ) as unknown as typeof fetch;
    try {
      const result = await performUpdate({ currentVersion: '1.0.0', fromSource: false });
      expect(result.updated).toBe(false);
      expect(result.message.toLowerCase()).toMatch(/up to date|latest/);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

/**
 * Spec for update-check.
 *
 * Contract:
 *   getAvailableUpdate():
 *     - returns null when no cache exists
 *     - returns null when cache version equals current (or older)
 *     - returns the cached version string when newer than current
 *     - semver comparison ignores pre-release suffix ("1.2.3-beta" → 1.2.3)
 *
 *   startUpdateCheck(current):
 *     - persists the current version internally
 *     - hits the cache if it's < 24h old (no fetch)
 *
 *   printUpdateNotice():
 *     - no-op when startUpdateCheck was never called
 *     - prints to stderr when a newer version is available
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAvailableUpdate, printUpdateNotice, startUpdateCheck } from './update-check.ts';

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-upd-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});
afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const cachePath = () => path.join(tmpHome, '.gen-ai', 'update-check.json');

function writeCache(latestVersion: string, ageMs = 0): void {
  fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
  fs.writeFileSync(
    cachePath(),
    JSON.stringify({
      lastCheck: new Date(Date.now() - ageMs).toISOString(),
      latestVersion,
    }),
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  getAvailableUpdate                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getAvailableUpdate', () => {
  it('returns null when no cache exists', () => {
    startUpdateCheck('1.0.0'); // sets internal current version
    expect(getAvailableUpdate()).toBeNull();
  });

  it('returns null when cached version equals current', () => {
    writeCache('1.0.0');
    startUpdateCheck('1.0.0');
    expect(getAvailableUpdate()).toBeNull();
  });

  it('returns null when cached version is older', () => {
    writeCache('0.9.0');
    startUpdateCheck('1.0.0');
    expect(getAvailableUpdate()).toBeNull();
  });

  it('returns the cached version when newer (patch)', () => {
    writeCache('1.0.1');
    startUpdateCheck('1.0.0');
    expect(getAvailableUpdate()).toBe('1.0.1');
  });

  it('returns the cached version when newer (minor)', () => {
    writeCache('1.1.0');
    startUpdateCheck('1.0.5');
    expect(getAvailableUpdate()).toBe('1.1.0');
  });

  it('returns the cached version when newer (major)', () => {
    writeCache('2.0.0');
    startUpdateCheck('1.99.99');
    expect(getAvailableUpdate()).toBe('2.0.0');
  });

  it('ignores pre-release suffix when comparing', () => {
    writeCache('1.0.0-beta');
    startUpdateCheck('1.0.0');
    expect(getAvailableUpdate()).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  printUpdateNotice                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

function captureStderr(fn: () => Promise<void>): Promise<string> {
  let captured = '';
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  return fn()
    .then(() => captured)
    .finally(() => {
      process.stderr.write = orig;
    });
}

describe('printUpdateNotice', () => {
  it('prints a notice to stderr when a newer version is cached', async () => {
    writeCache('2.0.0');
    startUpdateCheck('1.0.0');
    const output = await captureStderr(printUpdateNotice);
    expect(output).toContain('2.0.0');
    expect(output.toLowerCase()).toContain('update');
  });

  it('does nothing when cached version is not newer', async () => {
    writeCache('1.0.0');
    startUpdateCheck('1.0.0');
    const output = await captureStderr(printUpdateNotice);
    expect(output).toBe('');
  });
});

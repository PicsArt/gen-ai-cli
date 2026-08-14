/**
 * Update-check ↔ self-update install-mode consistency.
 *
 * Regression: fetchLatestVersion used its own `GEN_AI_OCLIF_ROOT`-only
 * detection while performUpdate used detectInstallMode(), so a Bun-compiled
 * binary compared its version against the npm registry but installed from
 * the CDN. The check must consult the same detectInstallMode().
 *
 * Isolated in its own file because it mocks ./self-update.ts wholesale,
 * which would distort the main update-check spec.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const detectInstallModeMock = vi.hoisted(() => vi.fn());

vi.mock('./self-update.ts', () => ({
  detectInstallMode: detectInstallModeMock,
  isRunningFromSource: () => true,
  performUpdate: vi.fn(),
}));

import { startUpdateCheck } from './update-check.ts';

let tmpHome: string;
let originalHome: string | undefined;
let originalFetch: typeof fetch;
let fetchedUrls: string[];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-updmode-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  originalFetch = globalThis.fetch;
  fetchedUrls = [];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    fetchedUrls.push(String(url));
    return new Response(JSON.stringify({ version: '99.0.0' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  detectInstallModeMock.mockReset();
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  globalThis.fetch = originalFetch;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

async function flushBackgroundFetch(): Promise<void> {
  // startUpdateCheck stores the fetch promise internally; give it a tick.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('fetchLatestVersion routing', () => {
  it('checks the CDN latest.txt when the install mode is binary', async () => {
    detectInstallModeMock.mockReturnValue('binary');
    startUpdateCheck('1.0.0');
    await flushBackgroundFetch();
    expect(fetchedUrls).toHaveLength(1);
    expect(fetchedUrls[0]).toContain('latest.txt');
    expect(fetchedUrls[0]).not.toContain('registry.npmjs.org');
  });

  it('checks the npm registry when the install mode is npm', async () => {
    detectInstallModeMock.mockReturnValue('npm');
    startUpdateCheck('1.0.0');
    await flushBackgroundFetch();
    expect(fetchedUrls).toHaveLength(1);
    expect(fetchedUrls[0]).toContain('registry.npmjs.org');
  });
});

describe('fetchLatestVersion — wire validation', () => {
  it('does not cache a non-version latest.txt body (captive portal HTML)', async () => {
    detectInstallModeMock.mockReturnValue('binary');
    globalThis.fetch = vi.fn(
      async () => new Response('<!DOCTYPE html><html>hotel wifi login</html>', { status: 200 }),
    ) as unknown as typeof fetch;

    startUpdateCheck('1.0.0');
    await flushBackgroundFetch();

    // A rejected body must not be written to the 24h cache — otherwise the
    // garbage would be compared as a version on every startup for a day.
    const cachePath = path.join(tmpHome, '.gen-ai', 'update-check.json');
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it('caches a valid latest.txt version', async () => {
    detectInstallModeMock.mockReturnValue('binary');
    globalThis.fetch = vi.fn(async () => new Response('99.0.0\n', { status: 200 })) as unknown as typeof fetch;

    startUpdateCheck('1.0.0');
    await flushBackgroundFetch();

    const cachePath = path.join(tmpHome, '.gen-ai', 'update-check.json');
    expect(fs.existsSync(cachePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(cachePath, 'utf-8')).latestVersion).toBe('99.0.0');
  });
});

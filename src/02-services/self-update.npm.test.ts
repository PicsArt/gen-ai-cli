/**
 * npm-mode self-update — platform-correct npm invocation and hints.
 *
 * Regression: execFileSync('npm', ...) cannot spawn the npm.cmd shim on
 * Windows without a shell, so every npm call failed with ENOENT and users
 * were told "Permission denied. Try: sudo npm install" — wrong diagnosis
 * AND a sudo suggestion on Windows.
 *
 * Isolated in its own file because it mocks node:child_process wholesale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
  spawn: vi.fn(),
}));

import { performUpdate } from './self-update.ts';

const originalPlatform = process.platform;
let originalFetch: typeof fetch;
let originalOclifRoot: string | undefined;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalOclifRoot = process.env.GEN_AI_OCLIF_ROOT;
  delete process.env.GEN_AI_OCLIF_ROOT; // force npm install mode under Node
  // npm registry says a newer version exists
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ version: '99.0.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
  execFileSyncMock.mockReset();
});

afterEach(() => {
  setPlatform(originalPlatform);
  globalThis.fetch = originalFetch;
  if (originalOclifRoot !== undefined) process.env.GEN_AI_OCLIF_ROOT = originalOclifRoot;
  else delete process.env.GEN_AI_OCLIF_ROOT;
});

describe('performUpdate — npm mode, platform-correct npm invocation', () => {
  it('passes shell: true to execFileSync on Windows (npm is a .cmd shim)', async () => {
    setPlatform('win32');
    execFileSyncMock.mockImplementation(() => {
      throw new Error('EACCES');
    });
    await performUpdate({ currentVersion: '1.0.0' });
    expect(execFileSyncMock).toHaveBeenCalled();
    const [cmd, , opts] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe('npm');
    expect((opts as { shell?: boolean }).shell).toBe(true);
  });

  it('does not use a shell on POSIX platforms', async () => {
    setPlatform('linux');
    execFileSyncMock.mockImplementation(() => {
      throw new Error('EACCES');
    });
    await performUpdate({ currentVersion: '1.0.0' });
    const [, , opts] = execFileSyncMock.mock.calls[0];
    expect((opts as { shell?: boolean }).shell).toBe(false);
  });

  it('suggests an elevated prompt (not sudo) on Windows when writing fails', async () => {
    setPlatform('win32');
    execFileSyncMock.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const result = await performUpdate({ currentVersion: '1.0.0' });
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/administrator/i);
    expect(result.message).not.toMatch(/sudo/);
  });

  it('suggests sudo on POSIX when writing fails', async () => {
    setPlatform('darwin');
    execFileSyncMock.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const result = await performUpdate({ currentVersion: '1.0.0' });
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/sudo npm install/);
  });
});

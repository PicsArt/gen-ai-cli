/**
 * Terminal image previews — protocol detection (env-driven, cached per
 * module load, so each test re-imports a fresh module), the sixel
 * regression (no renderer exists → must NOT be advertised as supported),
 * and the no-protocol fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

const ENV_KEYS = ['TERM_PROGRAM', 'TERM', 'ITERM_SESSION_ID', 'VSCODE_PID', 'SIXEL_SUPPORT'] as const;

let savedEnv: Record<string, string | undefined>;
let originalIsTTYDesc: PropertyDescriptor | undefined;
const originalPlatform = process.platform;

function setStdoutTTY(isTTY: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
}

/** Re-import the module with a clean protocol cache. */
async function loadFresh(): Promise<typeof import('./terminal-image.ts')> {
  vi.resetModules();
  return await import('./terminal-image.ts');
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  originalIsTTYDesc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  spawnSyncMock.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  if (originalIsTTYDesc) Object.defineProperty(process.stdout, 'isTTY', originalIsTTYDesc);
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

describe('detectProtocol / supportsInlineImages', () => {
  it('reports no support when stdout is piped', async () => {
    setStdoutTTY(false);
    process.env.TERM_PROGRAM = 'iTerm.app';
    const mod = await loadFresh();
    expect(mod.supportsInlineImages()).toBe(false);
  });

  it('detects the iTerm2 protocol from TERM_PROGRAM', async () => {
    setStdoutTTY(true);
    process.env.TERM_PROGRAM = 'iTerm.app';
    const mod = await loadFresh();
    expect(mod.supportsInlineImages()).toBe(true);
  });

  it('detects the kitty protocol from TERM', async () => {
    setStdoutTTY(true);
    process.env.TERM = 'xterm-kitty';
    const mod = await loadFresh();
    expect(mod.supportsInlineImages()).toBe(true);
  });

  it('does NOT advertise sixel terminals as supported (no sixel renderer exists)', async () => {
    setStdoutTTY(true);
    process.env.TERM = 'mlterm-sixel';
    process.env.SIXEL_SUPPORT = '1';
    const mod = await loadFresh();
    expect(mod.supportsInlineImages()).toBe(false);
  });

  it('reports no support for an unknown TTY terminal', async () => {
    setStdoutTTY(true);
    process.env.TERM = 'xterm-256color';
    const mod = await loadFresh();
    expect(mod.supportsInlineImages()).toBe(false);
  });
});

describe('renderInline', () => {
  function captureStdout(fn: () => void): string {
    let output = '';
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      fn();
    } finally {
      process.stdout.write = orig;
    }
    return output;
  }

  it('emits an iTerm2 escape sequence with base64 payload', async () => {
    setStdoutTTY(true);
    process.env.TERM_PROGRAM = 'iTerm.app';
    const mod = await loadFresh();
    const data = Buffer.from('fake-image-bytes');
    const output = captureStdout(() => mod.renderInline(data, { label: 'pic' }));
    expect(output).toContain('\x1b]1337;File=');
    expect(output).toContain(data.toString('base64'));
  });

  it('emits kitty graphics chunks terminated with ESC \\', async () => {
    setStdoutTTY(true);
    process.env.TERM = 'xterm-kitty';
    const mod = await loadFresh();
    const output = captureStdout(() => mod.renderInline(Buffer.from('fake')));
    expect(output).toContain('\x1b_G');
    expect(output).toContain('\x1b\\');
  });

  it('prints a one-line text summary to stderr (not stdout) when no protocol is supported', async () => {
    setStdoutTTY(false);
    const mod = await loadFresh();
    let stderrOut = '';
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOut += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    let stdoutOut = '';
    try {
      stdoutOut = captureStdout(() => mod.renderInline(Buffer.from('x'.repeat(2048)), { label: 'result.png' }));
    } finally {
      process.stderr.write = origStderr;
    }
    expect(stderrOut).toContain('result.png');
    expect(stderrOut).toContain('2.0 KB');
    expect(stderrOut).not.toContain('\x1b]1337');
    // stdout must stay clean — it may be piped to a consumer.
    expect(stdoutOut).toBe('');
  });
});

describe('previewUrl', () => {
  it('skips the download entirely when the terminal cannot render images', async () => {
    setStdoutTTY(false);
    const mod = await loadFresh();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await mod.previewUrl('https://example.com/img.png');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('getImageDimensions', () => {
  it('parses `identify` output on non-macOS platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    setStdoutTTY(false);
    const mod = await loadFresh();
    spawnSyncMock.mockReturnValue({ stdout: '800 600' });
    expect(mod.getImageDimensions('/tmp/a.png')).toEqual({ width: 800, height: 600 });
  });

  it('parses `sips` output on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    setStdoutTTY(false);
    const mod = await loadFresh();
    spawnSyncMock.mockReturnValue({ stdout: '  pixelWidth: 1024\n  pixelHeight: 768\n' });
    expect(mod.getImageDimensions('/tmp/a.png')).toEqual({ width: 1024, height: 768 });
  });

  it('returns null when the tool is unavailable or output is unparsable', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    setStdoutTTY(false);
    const mod = await loadFresh();
    spawnSyncMock.mockReturnValue({ stdout: undefined, error: new Error('ENOENT') });
    expect(mod.getImageDimensions('/tmp/a.png')).toBe(null);
  });
});

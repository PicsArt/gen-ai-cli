/**
 * open / notify utilities — spawn wiring and the missing-binary regression:
 * a detached child MUST have an 'error' listener, otherwise a missing
 * xdg-open/powershell crashes the whole CLI with an unhandled error event.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

import { bell, openInDefault, sendNotification } from './open.ts';

interface FakeChild extends EventEmitter {
  unref: () => void;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.unref = vi.fn();
  return child;
}

const originalPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

let child: FakeChild;

beforeEach(() => {
  child = createFakeChild();
  spawnMock.mockReset().mockReturnValue(child);
  spawnSyncMock.mockReset().mockReturnValue({ status: 0 });
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe('openInDefault', () => {
  it('uses `open` on macOS with the raw target as an argument', () => {
    setPlatform('darwin');
    openInDefault('/tmp/result.png');
    expect(spawnMock).toHaveBeenCalledWith('open', ['/tmp/result.png'], expect.objectContaining({ detached: true }));
    expect(child.unref).toHaveBeenCalled();
  });

  it('uses `xdg-open` on Linux', () => {
    setPlatform('linux');
    openInDefault('https://example.com');
    expect(spawnMock).toHaveBeenCalledWith('xdg-open', ['https://example.com'], expect.anything());
  });

  it('escapes single quotes for PowerShell on Windows', () => {
    setPlatform('win32');
    openInDefault("C:\\it's here.png");
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('powershell');
    expect(args.join(' ')).toContain("it''s here.png");
  });

  it("attaches an 'error' listener so a missing binary cannot crash the process", () => {
    setPlatform('linux');
    openInDefault('file.png');
    expect(child.listenerCount('error')).toBeGreaterThan(0);
    // Without a listener this emit would throw (unhandled 'error' event).
    expect(() => child.emit('error', new Error('spawn xdg-open ENOENT'))).not.toThrow();
  });

  it('swallows synchronous spawn failures', () => {
    setPlatform('darwin');
    spawnMock.mockImplementation(() => {
      throw new Error('EPERM');
    });
    expect(() => openInDefault('x')).not.toThrow();
  });
});

describe('sendNotification', () => {
  it('escapes quotes and newlines for AppleScript on macOS', () => {
    setPlatform('darwin');
    sendNotification('Ti"tle', 'line1\nline2');
    const [cmd, args] = spawnSyncMock.mock.calls[0];
    expect(cmd).toBe('osascript');
    const script = args[1] as string;
    expect(script).toContain('Ti\\"tle');
    expect(script).not.toContain('\n');
  });

  it('uses notify-send elsewhere', () => {
    setPlatform('linux');
    sendNotification('Title', 'Message');
    expect(spawnSyncMock).toHaveBeenCalledWith('notify-send', ['Title', 'Message'], expect.anything());
  });

  it('swallows spawn failures', () => {
    setPlatform('linux');
    spawnSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(() => sendNotification('a', 'b')).not.toThrow();
  });
});

describe('bell', () => {
  it('writes the BEL character to stdout', () => {
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      bell();
    } finally {
      process.stdout.write = orig;
    }
    expect(writes.join('')).toBe('\x07');
  });
});

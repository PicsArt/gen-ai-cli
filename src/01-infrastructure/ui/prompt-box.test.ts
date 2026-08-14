/**
 * Prompt box — pure input helpers + the raw-mode key loop driven
 * through a fake stdin. Regressions covered: paste sanitization
 * (CR/CRLF/control bytes), surrogate-pair-safe backspace/arrows,
 * and the empty-submit warning not corrupting state.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextCharBoundary, prevCharBoundary, promptWithCommandBox, sanitizeInsertion } from './prompt-box.ts';

/* ─────────────────────────── pure helpers ─────────────────────────── */

describe('sanitizeInsertion', () => {
  it('passes plain printable text through unchanged', () => {
    expect(sanitizeInsertion('hello world')).toBe('hello world');
  });

  it('normalizes CRLF and lone CR to LF', () => {
    expect(sanitizeInsertion('a\r\nb')).toBe('a\nb');
    expect(sanitizeInsertion('a\rb')).toBe('a\nb');
    expect(sanitizeInsertion('a\r\n\rb')).toBe('a\n\nb');
  });

  it('converts tabs to spaces', () => {
    expect(sanitizeInsertion('a\tb')).toBe('a b');
  });

  it('strips other control characters', () => {
    expect(sanitizeInsertion('a\x07b\x00c\x1bd\x7fe')).toBe('abcde');
  });

  it('keeps newlines', () => {
    expect(sanitizeInsertion('line1\nline2')).toBe('line1\nline2');
  });

  it('returns an empty string for control-only input', () => {
    expect(sanitizeInsertion('\x02\x06')).toBe('');
  });
});

describe('prevCharBoundary / nextCharBoundary', () => {
  it('steps one unit over ASCII', () => {
    expect(prevCharBoundary('abc', 2)).toBe(1);
    expect(nextCharBoundary('abc', 1)).toBe(2);
  });

  it('steps over a whole surrogate pair', () => {
    const text = 'a😀b'; // 😀 occupies indices 1-2
    expect(prevCharBoundary(text, 3)).toBe(1);
    expect(nextCharBoundary(text, 1)).toBe(3);
  });

  it('clamps at the string edges', () => {
    expect(prevCharBoundary('abc', 0)).toBe(0);
    expect(nextCharBoundary('abc', 3)).toBe(3);
  });

  it('does not treat a lone surrogate as a pair', () => {
    const lone = `a${'\ud83d'}b`; // unpaired high surrogate at index 1
    expect(prevCharBoundary(lone, 2)).toBe(1);
    expect(nextCharBoundary(lone, 1)).toBe(2);
  });
});

/* ─────────────────────── interactive key loop ─────────────────────── */

interface FakeStdin extends EventEmitter {
  isTTY: boolean;
  setRawMode: (mode: boolean) => FakeStdin;
  resume: () => void;
  pause: () => void;
}

function createFakeStdin(): FakeStdin {
  const emitter = new EventEmitter() as FakeStdin;
  emitter.isTTY = true;
  emitter.setRawMode = () => emitter;
  emitter.resume = () => undefined;
  emitter.pause = () => undefined;
  return emitter;
}

let fakeStdin: FakeStdin;
let originalStdinDesc: PropertyDescriptor;
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  fakeStdin = createFakeStdin();
  originalStdinDesc = Object.getOwnPropertyDescriptor(process, 'stdin') as PropertyDescriptor;
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
  // Swallow the escape-sequence rendering so test output stays clean.
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;
});

afterEach(() => {
  Object.defineProperty(process, 'stdin', originalStdinDesc);
  process.stderr.write = originalStderrWrite;
});

function start(): Promise<string | null> {
  return promptWithCommandBox({ modelId: 'test-model', modelName: 'Test Model' });
}

function press(...chunks: string[]): void {
  for (const chunk of chunks) {
    fakeStdin.emit('data', Buffer.from(chunk, 'utf-8'));
  }
}

describe('promptWithCommandBox', () => {
  it('resolves the typed text on Enter', async () => {
    const promise = start();
    press('hello', '\r');
    await expect(promise).resolves.toBe('hello');
  });

  it('resolves null on ESC', async () => {
    const promise = start();
    press('abc', '\x1b');
    await expect(promise).resolves.toBe(null);
  });

  it('resolves null on Ctrl+C', async () => {
    const promise = start();
    press('\x03');
    await expect(promise).resolves.toBe(null);
  });

  it('normalizes a pasted CRLF chunk instead of inserting raw control bytes', async () => {
    const promise = start();
    press('foo\r\nbar', '\r');
    await expect(promise).resolves.toBe('foo\nbar');
  });

  it('strips control bytes from a pasted chunk', async () => {
    const promise = start();
    press('a\x07b\x00c', '\r');
    await expect(promise).resolves.toBe('abc');
  });

  it('inserts a newline on Shift+Enter (\\x1b\\r) and Ctrl+J', async () => {
    const promise = start();
    press('a', '\x1b\r', 'b', '\x0a', 'c', '\r');
    await expect(promise).resolves.toBe('a\nb\nc');
  });

  it('backspace deletes a whole emoji, not half a surrogate pair', async () => {
    const promise = start();
    press('x😀', '\x7f', 'y', '\r');
    await expect(promise).resolves.toBe('xy');
  });

  it('left arrow steps over an emoji as one character', async () => {
    const promise = start();
    // "a😀" then two lefts → cursor at start → insert "z"
    press('a😀', '\x1b[D', '\x1b[D', 'z', '\r');
    await expect(promise).resolves.toBe('za😀');
  });

  it('Home and End move the cursor to the edges', async () => {
    const promise = start();
    press('bc', '\x1b[H', 'a', '\x1b[F', 'd', '\r');
    await expect(promise).resolves.toBe('abcd');
  });

  it('does not submit empty input; accepts text typed afterwards', async () => {
    const promise = start();
    press('\r'); // empty → warning, still pending
    press('hi', '\r');
    await expect(promise).resolves.toBe('hi');
  });

  it('ignores unknown escape sequences', async () => {
    const promise = start();
    press('a', '\x1b[5~', '\x1b[A', 'b', '\r');
    await expect(promise).resolves.toBe('ab');
  });

  it('removes its data listener after resolving', async () => {
    const promise = start();
    press('done', '\r');
    await promise;
    expect(fakeStdin.listenerCount('data')).toBe(0);
  });
});

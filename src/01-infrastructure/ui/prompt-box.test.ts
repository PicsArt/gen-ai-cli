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

  it('supports SS3 arrow/Home/End sequences (application cursor-keys mode)', async () => {
    const promise = start();
    press('a😀', '\x1bOD', '\x1bOD', 'z', '\x1bOF', 'w', '\x1bOH', 'q', '\r');
    await expect(promise).resolves.toBe('qza😀w');
  });

  it('reassembles a UTF-8 character split across stdin chunks (large paste)', async () => {
    const promise = start();
    const emoji = Buffer.from('😀', 'utf-8'); // 4 bytes
    fakeStdin.emit('data', emoji.subarray(0, 2));
    fakeStdin.emit('data', emoji.subarray(2));
    press('x', '\r');
    await expect(promise).resolves.toBe('😀x');
  });
});

/* ─────────────────── rendering (virtual terminal) ─────────────────── */

/**
 * Minimal terminal emulator — interprets the escape sequences the prompt box
 * emits (CSI A cursor-up, CSI G column, CSI J clear-below, CR, LF) so tests
 * can assert what actually ends up on screen, not just the resolved value.
 */
class VirtualTerminal {
  rows: string[] = [''];
  row = 0;
  col = 0;

  write(data: string): void {
    let i = 0;
    while (i < data.length) {
      const ch = data[i];
      if (ch === '\x1b') {
        const csi = data.slice(i).match(/^\x1b\[([0-9]*)([AGJ])/);
        if (csi) {
          const n = csi[1] === '' ? (csi[2] === 'J' ? 0 : 1) : Number(csi[1]);
          if (csi[2] === 'A') this.row = Math.max(0, this.row - n);
          else if (csi[2] === 'G') this.col = n - 1;
          else if (csi[2] === 'J') {
            this.rows[this.row] = (this.rows[this.row] ?? '').slice(0, this.col);
            this.rows = this.rows.slice(0, this.row + 1);
          }
          i += csi[0].length;
          continue;
        }
        // Strip SGR / OSC 8 (color is disabled in tests, but be safe).
        const other = data.slice(i).match(/^\x1b\[[0-9;]*m|^\x1b\]8;;[^\x07]*\x07/);
        if (other) {
          i += other[0].length;
          continue;
        }
        i++;
        continue;
      }
      if (ch === '\r') {
        this.col = 0;
        i++;
        continue;
      }
      if (ch === '\n') {
        this.row++;
        this.col = 0;
        while (this.rows.length <= this.row) this.rows.push('');
        i++;
        continue;
      }
      while (this.rows.length <= this.row) this.rows.push('');
      const line = this.rows[this.row].padEnd(this.col, ' ');
      this.rows[this.row] = line.slice(0, this.col) + ch + line.slice(this.col + 1);
      this.col++;
      i++;
    }
  }

  /** Indexes of rows that consist of the horizontal rule character. */
  ruleRows(): number[] {
    return this.rows.flatMap((r, i) => (/^─+$/.test(r.trim()) && r.trim().length > 0 ? [i] : []));
  }
}

describe('promptWithCommandBox rendering', () => {
  let term: VirtualTerminal;

  beforeEach(() => {
    term = new VirtualTerminal();
    process.stderr.write = ((chunk: string | Uint8Array) => {
      term.write(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  it('editing above the last line of a multi-line prompt does not destroy the lines above the box', async () => {
    const promise = start();
    press('abc', '\x1b\r', 'def', '\x1b\r', 'ghi'); // 3-line prompt
    press('\x1b[H', 'X'); // Home → insert at line 0

    // The instruction line and BOTH rules must survive the re-render.
    expect(term.rows.some((r) => r.includes('e.g.'))).toBe(true);
    expect(term.ruleRows()).toHaveLength(2);
    expect(term.rows.some((r) => r.includes('Xabc'))).toBe(true);
    expect(term.rows.some((r) => r.trim() === 'ghi')).toBe(true);

    press('\x03'); // cancel to clean up
    await promise;
  });

  it('submitting with the cursor on an earlier line leaves the cursor below the box', async () => {
    const promise = start();
    press('abc', '\x1b\r', 'def', '\x1b\r', 'ghi');
    press('\x1b[H', '\r'); // Home, then submit with the cursor on line 0
    await expect(promise).resolves.toBe('abc\ndef\nghi');

    // Whatever the CLI prints next must land BELOW the bottom rule, not
    // inside the prompt box.
    process.stderr.write('NEXT-OUTPUT\n');
    const markerRow = term.rows.findIndex((r) => r.includes('NEXT-OUTPUT'));
    const rules = term.ruleRows();
    expect(rules).toHaveLength(2);
    expect(markerRow).toBeGreaterThan(rules[1]);
    // The prompt content is intact.
    expect(term.rows.some((r) => r.trim() === 'ghi')).toBe(true);
  });

  it('positions the cursor by display width after a 2-column emoji', async () => {
    const promise = start();
    press('😀');
    const prefixVis = 4 + 'gen-ai generate -m test-model -p '.length;
    expect(term.col).toBe(prefixVis + 2); // emoji occupies 2 cells, not 1
    press('\x03');
    await promise;
  });

  it('recovers cleanly after the empty-submit warning', async () => {
    const promise = start();
    press('\r'); // empty → warning replaces the input row
    expect(term.rows.some((r) => r.includes('prompt cannot be empty'))).toBe(true);
    press('ok', '\r');
    await expect(promise).resolves.toBe('ok');
    // Warning is gone and the box is intact.
    expect(term.rows.some((r) => r.includes('prompt cannot be empty'))).toBe(false);
    expect(term.ruleRows()).toHaveLength(2);
  });
});

/* ─────────────────── fallback prompt (non-TTY stdin) ─────────────────── */

describe('promptWithCommandBox fallback', () => {
  let savedStderrTty: PropertyDescriptor | undefined;

  beforeEach(() => {
    fakeStdin.isTTY = false;
    // Force readline into non-terminal mode so the fake stdin's plain
    // 'data'/'end' events drive it deterministically.
    savedStderrTty = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    if (savedStderrTty) Object.defineProperty(process.stderr, 'isTTY', savedStderrTty);
    else Reflect.deleteProperty(process.stderr, 'isTTY');
  });

  /** Let the dynamic `import('node:readline')` inside fallbackPrompt settle. */
  function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  it('resolves the typed line', async () => {
    const promise = start();
    await settle();
    fakeStdin.emit('data', Buffer.from('hello world\n'));
    await expect(promise).resolves.toBe('hello world');
  });

  it('resolves null on EOF (Ctrl+D) instead of hanging', async () => {
    const promise = start();
    await settle();
    fakeStdin.emit('end');
    await expect(promise).resolves.toBe(null);
  });
});

/* ───────────────────────── terminal resize ───────────────────────── */

describe('promptWithCommandBox resize', () => {
  let savedColumns: PropertyDescriptor | undefined;

  beforeEach(() => {
    savedColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  });

  afterEach(() => {
    if (savedColumns) Object.defineProperty(process.stdout, 'columns', savedColumns);
    else Reflect.deleteProperty(process.stdout, 'columns');
  });

  it('keeps accepting input after a resize and removes the listener on cleanup', async () => {
    const before = process.stdout.listenerCount('resize');
    const promise = start();
    expect(process.stdout.listenerCount('resize')).toBe(before + 1);
    press('hello');
    Object.defineProperty(process.stdout, 'columns', { value: 50, configurable: true });
    process.stdout.emit('resize');
    press(' world', '\r');
    await expect(promise).resolves.toBe('hello world');
    expect(process.stdout.listenerCount('resize')).toBe(before);
  });

  it('redraws the box at the new width after a resize', async () => {
    const term = new VirtualTerminal();
    process.stderr.write = ((chunk: string | Uint8Array) => {
      term.write(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    const promise = start();
    press('hi');
    Object.defineProperty(process.stdout, 'columns', { value: 50, configurable: true });
    process.stdout.emit('resize');

    // The redrawn bottom rule uses the new width (50 - 4 = 46 columns).
    const rules = term.ruleRows();
    expect(rules.length).toBeGreaterThan(0);
    expect(term.rows[rules[rules.length - 1]].trim()).toHaveLength(46);

    press('\x03');
    await promise;
  });
});

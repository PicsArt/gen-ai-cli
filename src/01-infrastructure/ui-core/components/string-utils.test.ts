/**
 * String utilities — ANSI stripping, visible width, truncation.
 * Includes regressions for truncate() edge cases (maxWidth <= 1,
 * partial-link lines must not become fully clickable).
 */
import { describe, expect, it } from 'vitest';
import { getMaxWidth, stripAnsi, truncate, visibleWidth } from './string-utils.ts';

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function osc8(text: string, url: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

describe('stripAnsi', () => {
  it('removes SGR color sequences', () => {
    expect(stripAnsi(`${RED}hello${RESET}`)).toBe('hello');
  });

  it('removes OSC 8 hyperlink wrappers but keeps the link text', () => {
    expect(stripAnsi(osc8('click me', 'https://example.com'))).toBe('click me');
  });

  it('is a no-op on plain text', () => {
    expect(stripAnsi('plain')).toBe('plain');
  });
});

describe('visibleWidth', () => {
  it('counts only visible characters', () => {
    expect(visibleWidth(`${RED}abc${RESET}`)).toBe(3);
    expect(visibleWidth(osc8('abcd', 'https://example.com'))).toBe(4);
    expect(visibleWidth('')).toBe(0);
  });
});

describe('truncate', () => {
  it('returns text unchanged when it fits', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exact', 5)).toBe('exact');
  });

  it('truncates with an ellipsis when too long', () => {
    expect(truncate('abcdefgh', 5)).toBe('abcd…');
    expect(visibleWidth(truncate('abcdefgh', 5))).toBe(5);
  });

  it('handles maxWidth 0 and negative without producing oversized output', () => {
    expect(truncate('abcdef', 0)).toBe('');
    expect(truncate('abcdef', -3)).toBe('');
  });

  it('handles maxWidth 1', () => {
    expect(truncate('abcdef', 1)).toBe('…');
  });

  it('re-wraps the URL when the whole line is one hyperlink', () => {
    const link = osc8('a-very-long-link-label', 'https://example.com/full');
    const result = truncate(link, 10);
    expect(result).toContain('\x1b]8;;https://example.com/full\x07');
    expect(visibleWidth(result)).toBe(10);
  });

  it('does NOT expand a partial link over unrelated surrounding text', () => {
    const line = `prefix text ${osc8('link', 'https://example.com')} suffix that overflows`;
    const result = truncate(line, 15);
    // Truncated plain text — the link must not swallow the whole line.
    expect(result).not.toContain('\x1b]8;;');
    expect(visibleWidth(result)).toBe(15);
  });

  it('measures by visible width, not raw length, for colored text', () => {
    const colored = `${RED}abc${RESET}`;
    expect(truncate(colored, 3)).toBe(colored); // fits: visible width 3
  });
});

describe('getMaxWidth', () => {
  it('returns the explicit value when given', () => {
    expect(getMaxWidth(72)).toBe(72);
  });

  it('falls back to terminal columns or 80', () => {
    const result = getMaxWidth();
    expect(result).toBe(process.stdout.columns || 80);
  });
});

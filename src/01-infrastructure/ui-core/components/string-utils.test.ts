/**
 * String utilities — ANSI stripping, visible width, truncation.
 * Includes regressions for truncate() edge cases (maxWidth <= 1,
 * partial-link lines must not become fully clickable).
 */
import { describe, expect, it } from 'vitest';
import {
  getMaxWidth,
  graphemeWidth,
  sanitizeTerminalText,
  stringWidth,
  stripAnsi,
  tailWindow,
  truncate,
  visibleWidth,
} from './string-utils.ts';

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

  it('counts CJK characters as 2 columns', () => {
    expect(visibleWidth('你好')).toBe(4);
    expect(visibleWidth('a你b')).toBe(4);
    expect(visibleWidth('カタカナ')).toBe(8);
  });

  it('counts emoji as 2 columns, including through ANSI styling', () => {
    expect(visibleWidth('😀')).toBe(2);
    expect(visibleWidth(`${RED}x😀y${RESET}`)).toBe(4);
  });

  it('counts a ZWJ sequence and a flag as one 2-column glyph', () => {
    expect(visibleWidth('👨‍👩‍👧')).toBe(2); // family (3 people joined by ZWJ)
    expect(visibleWidth('🇦🇲')).toBe(2); // flag (regional-indicator pair)
  });

  it('counts VS16 emoji-presentation sequences as 2 columns', () => {
    expect(visibleWidth('🖼️')).toBe(2); // U+1F5BC U+FE0F
    expect(visibleWidth('⚠️')).toBe(2); // U+26A0 U+FE0F
  });

  it('gives combining marks zero width', () => {
    expect(visibleWidth('é')).toBe(1); // e + combining acute
    expect(visibleWidth('a​b')).toBe(2); // zero-width space
  });
});

describe('stringWidth / graphemeWidth', () => {
  it('matches length for plain ASCII (fast path)', () => {
    expect(stringWidth('hello world')).toBe(11);
    expect(stringWidth('')).toBe(0);
  });

  it('measures individual graphemes', () => {
    expect(graphemeWidth('a')).toBe(1);
    expect(graphemeWidth('你')).toBe(2);
    expect(graphemeWidth('😀')).toBe(2);
    expect(graphemeWidth('́')).toBe(0);
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

  it('keeps a partial link bounded to its own text — never swallowing the surrounding line', () => {
    const line = `prefix text ${osc8('link', 'https://example.com')} suffix that overflows`;
    const result = truncate(line, 15);
    // The prefix stays outside the link; the link opens at its real start
    // and is closed at the cut so it cannot swallow unrelated text.
    expect(result.startsWith('prefix text \x1b]8;;https://example.com\x07')).toBe(true);
    expect(result.endsWith('\x1b]8;;\x07')).toBe(true);
    expect(result).not.toContain('suffix');
    expect(visibleWidth(result)).toBe(15);
  });

  it('measures by visible width, not raw length, for colored text', () => {
    const colored = `${RED}abc${RESET}`;
    expect(truncate(colored, 3)).toBe(colored); // fits: visible width 3
  });

  it('preserves ANSI styling on the kept portion and appends a reset', () => {
    const result = truncate(`${RED}abcdefgh${RESET}`, 5);
    expect(result).toContain(RED);
    expect(result.endsWith(RESET)).toBe(true);
    expect(stripAnsi(result)).toBe('abcd…');
    expect(visibleWidth(result)).toBe(5);
  });

  it('never splits an emoji surrogate pair at the cut point', () => {
    const result = truncate('a😀bcdef', 3);
    // Budget of 2 columns: 'a' fits, the 2-wide emoji does not — cut before it.
    expect(result).toBe('a…');
    // No lone surrogates anywhere in the output.
    expect(result).not.toMatch(/[\ud800-\udfff](?![\udc00-\udfff])/);
  });

  it('accounts for wide characters when filling the budget', () => {
    const result = truncate('你好世界啊', 6);
    // 5 CJK chars = 10 columns; budget 5 columns → two chars (4) + ellipsis.
    expect(result).toBe('你好…');
    expect(visibleWidth(result)).toBe(5);
  });
});

describe('tailWindow', () => {
  it('returns the whole text when it fits', () => {
    expect(tailWindow('abc', 10)).toEqual({ display: 'abc', startIndex: 0 });
  });

  it('returns the widest fitting tail with its start index', () => {
    expect(tailWindow('abcdefgh', 3)).toEqual({ display: 'fgh', startIndex: 5 });
  });

  it('does not split an emoji at the window edge', () => {
    const { display } = tailWindow('ab😀cd', 3);
    // 'cd' (2) fits; adding the 2-wide emoji would need 4 → window is '😀cd'? No:
    // emoji + 'cd' = 4 > 3, so the window starts after the emoji.
    expect(display).toBe('cd');
    expect(display).not.toMatch(/[\ud800-\udfff](?![\udc00-\udfff])/);
  });

  it('measures wide chars by display width', () => {
    expect(tailWindow('你好世界', 4).display).toBe('世界');
  });

  it('handles a zero or negative budget', () => {
    expect(tailWindow('abc', 0)).toEqual({ display: '', startIndex: 3 });
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

describe('sanitizeTerminalText', () => {
  it('returns strings without control bytes unchanged', () => {
    expect(sanitizeTerminalText('plain text')).toBe('plain text');
    expect(sanitizeTerminalText('multi\nline')).toBe('multi\nline');
  });

  it('strips raw BEL, CR, DEL, and C1 control bytes', () => {
    expect(sanitizeTerminalText('a\x07b\rc\x7fd\x9be')).toBe('abcde');
  });

  it('defangs escape sequences that are not SGR or OSC 8', () => {
    // Cursor moves / screen clears lose their ESC byte and become visible text
    expect(sanitizeTerminalText('a\x1b[2Jb')).toBe('a[2Jb');
    // Window-title spoofing (OSC 0) loses ESC and BEL
    expect(sanitizeTerminalText('a\x1b]0;spoof\x07b')).toBe('a]0;spoofb');
    // OSC 52 clipboard write
    expect(sanitizeTerminalText('\x1b]52;c;ZXZpbA==\x07')).toBe(']52;c;ZXZpbA==');
  });

  it('preserves SGR color sequences', () => {
    const styled = '\x1b[31mred\x1b[0m and \x1b[1mbold\x1b[0m';
    expect(sanitizeTerminalText(styled)).toBe(styled);
  });

  it('preserves OSC 8 hyperlinks', () => {
    const linked = '\x1b]8;;https://example.com\x07label\x1b]8;;\x07';
    expect(sanitizeTerminalText(linked)).toBe(linked);
  });

  it('strips smuggled controls between preserved sequences', () => {
    expect(sanitizeTerminalText('\x1b[31m\x07x\x1b[0m')).toBe('\x1b[31mx\x1b[0m');
  });

  it('converts tabs to spaces and keeps newlines', () => {
    expect(sanitizeTerminalText('a\tb\nc\x07')).toBe('a b\nc');
  });
});

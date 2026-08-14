// eslint-disable-next-line no-control-regex
const STRIP_ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;

export function stripAnsi(text: string): string {
  return text.replace(STRIP_ANSI_RE, '');
}

// Fast path: strings without escapes, wide chars, or combining marks are the
// overwhelmingly common case — their display width is just their length.
// eslint-disable-next-line no-control-regex
const ASCII_PRINTABLE_RE = /^[\x20-\x7e]*$/;

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Code points that occupy no terminal column (combining marks, ZW*, variation selectors). */
function isZeroWidthCodePoint(cp: number): boolean {
  return (
    (cp >= 0x200b && cp <= 0x200f) || // ZWSP, ZWNJ, ZWJ, LRM, RLM
    cp === 0x2060 || // word joiner
    cp === 0xfeff || // BOM / ZWNBSP
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritics
    (cp >= 0x1ab0 && cp <= 0x1aff) || // combining diacritics extended
    (cp >= 0x1dc0 && cp <= 0x1dff) || // combining diacritics supplement
    (cp >= 0x20d0 && cp <= 0x20ff) || // combining marks for symbols
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0xfe20 && cp <= 0xfe2f) || // combining half marks
    (cp >= 0xe0100 && cp <= 0xe01ef) // variation selectors supplement
  );
}

/** East Asian Wide/Fullwidth ranges plus emoji-presentation blocks — 2 columns. */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x231a && cp <= 0x231b) || // watch
    (cp >= 0x23e9 && cp <= 0x23ec) ||
    cp === 0x23f0 ||
    cp === 0x23f3 ||
    (cp >= 0x25fd && cp <= 0x25fe) ||
    (cp >= 0x2614 && cp <= 0x2615) ||
    (cp >= 0x2648 && cp <= 0x2653) ||
    cp === 0x267f ||
    cp === 0x2693 ||
    cp === 0x26a1 ||
    (cp >= 0x26aa && cp <= 0x26ab) ||
    (cp >= 0x26bd && cp <= 0x26be) ||
    (cp >= 0x26c4 && cp <= 0x26c5) ||
    cp === 0x26ce ||
    cp === 0x26d4 ||
    cp === 0x26ea ||
    (cp >= 0x26f2 && cp <= 0x26f3) ||
    cp === 0x26f5 ||
    cp === 0x26fa ||
    cp === 0x26fd ||
    cp === 0x2705 ||
    (cp >= 0x270a && cp <= 0x270b) ||
    cp === 0x2728 ||
    cp === 0x274c ||
    cp === 0x274e ||
    (cp >= 0x2753 && cp <= 0x2755) ||
    cp === 0x2757 ||
    (cp >= 0x2795 && cp <= 0x2797) ||
    cp === 0x27b0 ||
    cp === 0x27bf ||
    (cp >= 0x2b1b && cp <= 0x2b1c) ||
    cp === 0x2b50 ||
    cp === 0x2b55 ||
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals … CJK symbols (excl. 0x303f)
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xa960 && cp <= 0xa97f) || // Hangul Jamo ext A
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe10 && cp <= 0xfe19) || // vertical forms
    (cp >= 0xfe30 && cp <= 0xfe6b) || // CJK compatibility forms, small forms
    (cp >= 0xff01 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1f0ff) || // mahjong, dominoes, cards
    (cp >= 0x1f300 && cp <= 0x1f64f) || // emoji & pictographs, emoticons
    (cp >= 0x1f680 && cp <= 0x1f6ff) || // transport
    (cp >= 0x1f900 && cp <= 0x1f9ff) || // supplemental symbols
    (cp >= 0x1fa70 && cp <= 0x1faff) || // symbols ext A
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B+
  );
}

function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/**
 * Terminal display width of one grapheme cluster. ZWJ sequences (👨‍👩‍👧) and
 * flag pairs (🇦🇲) render as a single 2-column glyph; a VS16 forces emoji
 * presentation (⚠️) which is also 2 columns.
 */
export function graphemeWidth(grapheme: string): number {
  const codePoints: number[] = [];
  for (const ch of grapheme) codePoints.push(ch.codePointAt(0) as number);

  if (codePoints.length >= 2 && isRegionalIndicator(codePoints[0]) && isRegionalIndicator(codePoints[1])) {
    return 2; // flag emoji
  }
  const base = codePoints.find((cp) => !isZeroWidthCodePoint(cp));
  if (base === undefined) return 0; // cluster of only zero-width marks
  if (codePoints.includes(0xfe0f)) return 2; // VS16 → emoji presentation
  return isWideCodePoint(base) ? 2 : 1;
}

/** Display width of plain (ANSI-free) text, wide-char and grapheme aware. */
export function stringWidth(text: string): number {
  if (ASCII_PRINTABLE_RE.test(text)) return text.length;
  let width = 0;
  for (const { segment } of SEGMENTER.segment(text)) {
    width += graphemeWidth(segment);
  }
  return width;
}

/** Display width of possibly-styled text: strips ANSI, then measures. */
export function visibleWidth(text: string): number {
  return stringWidth(stripAnsi(text));
}

// Split into alternating text / ANSI-sequence tokens (capture keeps the sequences).
// eslint-disable-next-line no-control-regex
const ANSI_SPLIT_RE = /(\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07)/;
const OSC8_CLOSE = '\x1b]8;;\x07';
const SGR_RESET = '\x1b[0m';

/**
 * Truncate styled text to `maxWidth` display columns, ending with an ellipsis.
 * ANSI sequences pass through so the kept portion retains its styling (a
 * reset is appended if any SGR was emitted), an OSC 8 hyperlink left open at
 * the cut is closed, and grapheme clusters are never split.
 */
export function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return '…';

  const budget = maxWidth - 1; // reserve one column for the ellipsis
  let out = '';
  let used = 0;
  let sawSgr = false;
  let linkOpen = false;

  outer: for (const part of text.split(ANSI_SPLIT_RE)) {
    if (part === '') continue;
    if (part.startsWith('\x1b[')) {
      out += part;
      sawSgr = true;
      continue;
    }
    if (part.startsWith('\x1b]8;;')) {
      out += part;
      linkOpen = part !== OSC8_CLOSE;
      continue;
    }
    for (const { segment } of SEGMENTER.segment(part)) {
      const w = graphemeWidth(segment);
      if (used + w > budget) break outer;
      out += segment;
      used += w;
    }
  }

  out += '…';
  if (linkOpen) out += OSC8_CLOSE;
  if (sawSgr) out += SGR_RESET;
  return out;
}

/**
 * The widest tail of `text` that fits in `maxWidth` display columns.
 * Returns the tail and its start index (in UTF-16 units) within `text`.
 * Used to keep the end of an over-long input line visible while typing.
 */
export function tailWindow(text: string, maxWidth: number): { display: string; startIndex: number } {
  if (maxWidth <= 0) return { display: '', startIndex: text.length };
  if (stringWidth(text) <= maxWidth) return { display: text, startIndex: 0 };

  const segments = [...SEGMENTER.segment(text)];
  let width = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    width += graphemeWidth(segments[i].segment);
    if (width > maxWidth) {
      const start = segments[i + 1]?.index ?? text.length;
      return { display: text.slice(start), startIndex: start };
    }
  }
  return { display: text, startIndex: 0 };
}

export function getMaxWidth(maxWidth?: number): number {
  return maxWidth ?? (process.stdout.columns || 80);
}

// Control bytes an untrusted string could use to smuggle terminal escapes:
// all C0 controls except \t and \n (handled separately), DEL, and the C1
// range (0x9b is an alias for CSI on many terminals). \x1b is included —
// legitimate SGR/OSC 8 sequences are preserved by sanitizeTerminalText
// before this strip runs.
// eslint-disable-next-line no-control-regex
const UNSAFE_CONTROL_RE = /[\0-\x08\x0b-\x1f\x7f-\x9f]/g;
// eslint-disable-next-line no-control-regex
const HAS_CONTROL_RE = /[\0-\x08\x0b-\x1f\x7f-\x9f\t]/;
// Same alternatives as STRIP_ANSI_RE, but a fresh /g instance for matchAll.
// eslint-disable-next-line no-control-regex
const ALLOWED_ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;

/**
 * Scrub raw control bytes from an untrusted string headed for the terminal
 * (API/model-supplied names, URLs, messages) so it cannot inject escape
 * sequences (cursor movement, OSC 52 clipboard writes, title spoofing).
 * SGR color and OSC 8 hyperlink sequences that our own renderers emit are
 * preserved; newlines survive and tabs become single spaces.
 */
export function sanitizeTerminalText(text: string): string {
  if (!HAS_CONTROL_RE.test(text)) return text;
  const clean = (s: string): string => s.replace(/\t/g, ' ').replace(UNSAFE_CONTROL_RE, '');
  let result = '';
  let last = 0;
  for (const match of text.matchAll(ALLOWED_ANSI_RE)) {
    result += clean(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return result + clean(text.slice(last));
}

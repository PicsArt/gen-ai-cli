// eslint-disable-next-line no-control-regex
const STRIP_ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;

export function stripAnsi(text: string): string {
  return text.replace(STRIP_ANSI_RE, '');
}

export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

// eslint-disable-next-line no-control-regex
const OSC8_RE = /\x1b\]8;;([^\x07]*)\x07([\s\S]*?)\x1b\]8;;\x07/;

export function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return '\u2026';
  const plain = stripAnsi(text);
  const truncated = `${plain.slice(0, maxWidth - 1)}\u2026`;

  // If the whole visible text was one OSC 8 hyperlink, re-wrap the truncated
  // text so clicking still opens the full URL. A link covering only part of
  // the line must NOT be expanded over the unrelated surrounding text.
  const linkMatch = text.match(OSC8_RE);
  if (linkMatch && stripAnsi(linkMatch[0]) === plain) {
    const url = linkMatch[1];
    return `\x1b]8;;${url}\x07${truncated}\x1b]8;;\x07`;
  }

  return truncated;
}

export function getMaxWidth(maxWidth?: number): number {
  return maxWidth ?? (process.stdout.columns || 80);
}

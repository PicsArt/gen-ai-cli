import type { ColorManager } from '../color.ts';
import { visibleWidth } from './string-utils.ts';

export interface KVOptions {
  color: ColorManager;
  indent?: number; // left indent, default 2
  gap?: number; // space between key and value, default 4
  dimKeys?: boolean; // dim the key text, default true
  maxWidth?: number; // wrap long values at this width (0 = no wrap)
}

/** Wrap text at word boundaries to fit within maxLen characters per line. */
function wordWrap(text: string, maxLen: number): string[] {
  if (maxLen <= 0 || visibleWidth(text) <= maxLen) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (visibleWidth(candidate) > maxLen && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function renderKeyValue(pairs: [string, string][], opts: KVOptions): string {
  if (pairs.length === 0) return '';

  const { color, indent = 2, gap = 4, dimKeys = true } = opts;
  const maxWidth = opts.maxWidth ?? (process.stdout.columns || 120);

  const maxKeyWidth = pairs.reduce((max, [key]) => Math.max(max, visibleWidth(key)), 0);

  const indentStr = ' '.repeat(indent);
  const prefixWidth = indent + maxKeyWidth + gap;
  const valueWidth = maxWidth - prefixWidth - 4; // 4 = card border + padding slack

  const lines: string[] = [];
  for (const [key, value] of pairs) {
    const keyPadded = key + ' '.repeat(maxKeyWidth - visibleWidth(key));
    const renderedKey = dimKeys ? color.dim(keyPadded) : keyPadded;
    const gapStr = ' '.repeat(gap);

    const wrapped = wordWrap(value, Math.max(valueWidth, 20));
    lines.push(`${indentStr}${renderedKey}${gapStr}${wrapped[0]}`);
    // Continuation lines aligned under value column
    const continuation = ' '.repeat(prefixWidth);
    for (let i = 1; i < wrapped.length; i++) {
      lines.push(`${continuation}${wrapped[i]}`);
    }
  }

  return lines.join('\n');
}

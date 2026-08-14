import type { ColorManager } from '../color.ts';
import { truncate, visibleWidth } from './string-utils.ts';

export interface CardOptions {
  color: ColorManager;
  title?: string;
  borderColor?: string;
  padding?: number;
  width?: number;
  maxWidth?: number;
  plain?: boolean;
}

// Box-drawing characters
const TOP_LEFT = '╭';
const TOP_RIGHT = '╮';
const BOTTOM_LEFT = '╰';
const BOTTOM_RIGHT = '╯';
const VERTICAL = '│';
const HORIZONTAL = '─';

export function renderCard(lines: string[], opts: CardOptions): string {
  const { color, title, padding = 2, plain = false } = opts;
  const borderColor = opts.borderColor ?? '#E859B4';
  const maxWidth = opts.maxWidth ?? Math.min(process.stdout.columns ?? 100, 120);

  // Plain mode: no borders, just indented content
  if (plain) {
    const output: string[] = [];
    if (title) {
      output.push(`  ${title}`);
      output.push('');
    }
    for (const line of lines) {
      output.push(`  ${line}`);
    }
    return `${output.join('\n')}\n`;
  }

  const colorFn = color.enabled ? color.hex(borderColor) : (t: string) => t;

  // Calculate the inner width (content area between borders, including padding)
  // Each line gets: │ + padding + content + padding + │
  // Total visible width: 2 (borders) + 2*padding + contentWidth
  const longestContent = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
  const titleWidth = title ? visibleWidth(title) + 4 : 0; // " Title " with "─ " prefix and " ─" suffix spacing

  const minInnerWidth = Math.max(longestContent + padding * 2, titleWidth);
  let totalWidth: number;

  if (opts.width !== undefined) {
    totalWidth = Math.min(opts.width, maxWidth);
  } else {
    totalWidth = Math.min(minInnerWidth + 2, maxWidth); // +2 for the two border chars
  }

  // Inner width is total minus the two border columns (floored at 0 —
  // a width option smaller than the borders must not crash repeat())
  const innerWidth = Math.max(0, totalWidth - 2);

  // Build top border
  let topBorder: string;
  if (title) {
    // ╭─ Title ───────────╮  (truncate a title longer than the card so the
    // top border can't stick out past the right edge)
    let titleText = `${HORIZONTAL} ${title} `;
    if (visibleWidth(titleText) > innerWidth) {
      titleText = truncate(titleText, innerWidth);
    }
    const titleVisibleLen = visibleWidth(titleText);
    const remainingDashes = Math.max(0, innerWidth - titleVisibleLen);
    topBorder = colorFn(TOP_LEFT + titleText + HORIZONTAL.repeat(remainingDashes) + TOP_RIGHT);
  } else {
    topBorder = colorFn(TOP_LEFT + HORIZONTAL.repeat(innerWidth) + TOP_RIGHT);
  }

  // Build bottom border
  const bottomBorder = colorFn(BOTTOM_LEFT + HORIZONTAL.repeat(innerWidth) + BOTTOM_RIGHT);

  // Build content lines with side borders and padding (floored at 0 so a
  // tiny width option can't produce negative-width truncation/padding)
  const contentAvailableWidth = Math.max(0, innerWidth - padding * 2);
  const output: string[] = [topBorder];

  // Helper to create a bordered line with content
  function borderedLine(content: string): string {
    const contentVis = visibleWidth(content);
    const rightPad = Math.max(0, contentAvailableWidth - contentVis);
    return (
      colorFn(VERTICAL) + ' '.repeat(padding) + content + ' '.repeat(rightPad) + ' '.repeat(padding) + colorFn(VERTICAL)
    );
  }

  // Empty line for vertical padding
  const emptyLine = borderedLine('');

  // Vertical padding top
  output.push(emptyLine);

  // Content lines
  for (const line of lines) {
    const truncated = visibleWidth(line) > contentAvailableWidth ? truncate(line, contentAvailableWidth) : line;
    output.push(borderedLine(truncated));
  }

  // Vertical padding bottom
  output.push(emptyLine);

  output.push(bottomBorder);

  return `${output.join('\n')}\n`;
}

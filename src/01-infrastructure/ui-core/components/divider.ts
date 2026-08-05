import type { ColorManager } from '../color.ts';
import { getMaxWidth } from './string-utils.ts';

export interface DividerOptions {
  color: ColorManager;
  label?: string;
  width?: number;
  plain?: boolean;
}

const THIN = '─';
const PLAIN = '-';
const LEAD_DASHES = 4;

export function renderDivider(opts: DividerOptions): string {
  const { color, label, plain = false } = opts;
  const width = opts.width ?? getMaxWidth();
  const dash = plain ? PLAIN : THIN;

  if (!label) {
    return color.dim(dash.repeat(width));
  }

  // Pattern: ──── Label ─────────
  // 4 leading dashes + space + label + space + trailing dashes
  const prefix = `${dash.repeat(LEAD_DASHES)} `;
  const suffix = ' ';
  const fixedLen = LEAD_DASHES + 1 + label.length + 1; // dashes + space + label + space
  const trailingCount = Math.max(0, width - fixedLen);
  const trailing = dash.repeat(trailingCount);

  return color.dim(prefix) + label + color.dim(suffix + trailing);
}

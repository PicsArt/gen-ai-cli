import type { ColorManager } from '../color.ts';
import { renderCard } from './card.ts';
import { getMaxWidth, visibleWidth } from './string-utils.ts';

export interface TableColumn {
  key: string;
  label?: string;
  align?: 'left' | 'right' | 'center';
}

export interface TableOptions {
  columns: TableColumn[];
  color: ColorManager;
  borderColor?: string;
  maxWidth?: number;
  plain?: boolean;
}

function padCell(text: string, width: number, align: 'left' | 'right' | 'center'): string {
  const vis = visibleWidth(text);
  const diff = Math.max(0, width - vis);
  if (align === 'right') {
    return ' '.repeat(diff) + text;
  }
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
  // left (default)
  return text + ' '.repeat(diff);
}

export function renderTable(rows: Record<string, string>[], opts: TableOptions): string {
  const { columns, color, plain = false } = opts;
  const gap = '  '; // 2-space gap between columns

  // Resolve labels (default to key)
  const labels = columns.map((c) => c.label ?? c.key);

  // Compute column widths: max of header label and all row values
  const colWidths = columns.map((col, i) => {
    let max = visibleWidth(labels[i]);
    for (const row of rows) {
      const val = String(row[col.key] ?? '');
      max = Math.max(max, visibleWidth(val));
    }
    return max;
  });

  // Build header row
  const headerCells = columns.map((col, i) => {
    const label = color.bold(labels[i]);
    return padCell(label, colWidths[i], col.align ?? 'left');
  });
  const headerLine = headerCells.join(gap);

  // Build separator line
  const totalContentWidth = colWidths.reduce((sum, w) => sum + w, 0) + gap.length * (columns.length - 1);
  const separator = color.dim('─'.repeat(totalContentWidth));

  // Build data rows
  const dataLines = rows.map((row) => {
    const cells = columns.map((col, i) => {
      const val = String(row[col.key] ?? '');
      return padCell(val, colWidths[i], col.align ?? 'left');
    });
    return cells.join(gap);
  });

  // Plain mode: tab-separated, no borders
  if (plain) {
    const plainHeader = labels.join('\t');
    const plainRows = rows.map((row) => columns.map((col) => String(row[col.key] ?? '')).join('\t'));
    return `${[plainHeader, ...plainRows].join('\n')}\n`;
  }

  // Compose lines and render inside a Card
  const lines = [headerLine, separator, ...dataLines];

  // Tables use full terminal width (not Card's 80-char default)
  const tableMaxWidth = opts.maxWidth ?? getMaxWidth();

  return renderCard(lines, {
    color,
    padding: 1,
    borderColor: opts.borderColor,
    maxWidth: tableMaxWidth,
  });
}

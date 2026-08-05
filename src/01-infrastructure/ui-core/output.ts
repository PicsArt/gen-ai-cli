import type { ColorManager } from './color.ts';
import { renderCard } from './components/card.ts';
import { renderDivider } from './components/divider.ts';
import { visibleWidth } from './components/string-utils.ts';
import { renderTable } from './components/table.ts';

export interface OutputManagerOptions {
  color: ColorManager;
  quiet: boolean;
  debug: boolean;
  jsonMode: boolean;
  plainMode: boolean;
}

export interface OutputManager {
  result(data: string): void;
  info(msg: string): void;
  success(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  warn(msg: string): void;
  json(data: unknown): void;
  table(rows: string[][], headers?: string[]): void;
  kvPairs(pairs: [string, string][]): void;
  card(lines: string[], opts?: { title?: string; borderColor?: string }): void;
  richTable(
    rows: Record<string, string>[],
    opts: { columns: { key: string; label?: string; align?: 'left' | 'right' | 'center' }[]; borderColor?: string },
  ): void;
  divider(opts?: { label?: string }): void;
}

function writeStdout(text: string): void {
  process.stdout.write(`${text}\n`);
}

function writeStderr(text: string): void {
  process.stderr.write(`${text}\n`);
}

function createOutputManagerImpl(opts: OutputManagerOptions): OutputManager {
  const { color, quiet, debug: debugMode, plainMode } = opts;

  return {
    result(data: string): void {
      writeStdout(data);
    },

    info(msg: string): void {
      if (quiet) return;
      const prefix = color.blue('i');
      writeStderr(`${prefix} ${msg}`);
    },

    success(msg: string): void {
      if (quiet) return;
      const prefix = color.green('✓');
      writeStderr(`${prefix} ${msg}`);
    },

    error(msg: string): void {
      const prefix = color.red('✗');
      writeStderr(`${prefix} ${msg}`);
    },

    debug(msg: string): void {
      if (!debugMode) return;
      const prefix = color.magenta('d');
      writeStderr(`${prefix} ${msg}`);
    },

    warn(msg: string): void {
      if (quiet) return;
      const prefix = color.yellow('!');
      writeStderr(`${prefix} ${msg}`);
    },

    json(data: unknown): void {
      writeStdout(JSON.stringify(data, null, 2));
    },

    table(rows: string[][], headers?: string[]): void {
      if (plainMode) {
        // Tab-separated in plain mode
        if (headers && headers.length > 0) {
          writeStdout(headers.join('\t'));
        }
        for (const row of rows) {
          writeStdout(row.join('\t'));
        }
        return;
      }

      // Calculate column widths (ANSI-aware)
      const allRows: string[][] = headers ? [headers, ...rows] : rows;
      const numCols = allRows.reduce((max, row) => Math.max(max, row.length), 0);
      const colWidths: number[] = Array(numCols).fill(0);

      for (const row of allRows) {
        for (let i = 0; i < row.length; i++) {
          colWidths[i] = Math.max(colWidths[i], visibleWidth(row[i] ?? ''));
        }
      }

      function formatRow(row: string[], pad = true): string {
        return row
          .map((cell, i) => {
            if (!pad || i === row.length - 1) return cell;
            const width = visibleWidth(cell);
            const padding = colWidths[i] - width;
            return cell + ' '.repeat(Math.max(0, padding));
          })
          .join('  ');
      }

      if (headers && headers.length > 0) {
        const boldHeaders = headers.map((h) => color.bold(h));
        writeStdout(formatRow(boldHeaders));
        // Separator line
        const sep = colWidths.map((w) => '-'.repeat(w)).join('  ');
        writeStdout(sep);
      }

      for (const row of rows) {
        writeStdout(formatRow(row));
      }
    },

    kvPairs(pairs: [string, string][]): void {
      const keyWidth = pairs.reduce((max, [k]) => Math.max(max, visibleWidth(k)), 0);

      for (const [key, value] of pairs) {
        const paddedKey = color.bold(key) + ' '.repeat(keyWidth - visibleWidth(key));
        writeStdout(`${paddedKey}  ${value}`);
      }
    },

    card(lines: string[], opts?: { title?: string; borderColor?: string }): void {
      writeStderr(renderCard(lines, { color, plain: plainMode, ...opts }));
    },

    richTable(
      rows: Record<string, string>[],
      opts: { columns: { key: string; label?: string; align?: 'left' | 'right' | 'center' }[]; borderColor?: string },
    ): void {
      writeStdout(renderTable(rows, { ...opts, color, plain: plainMode }));
    },

    divider(opts?: { label?: string }): void {
      writeStderr(renderDivider({ color, plain: plainMode, ...opts }));
    },
  };
}

let _instance: OutputManager | null = null;

export function createOutputManager(opts: OutputManagerOptions): OutputManager {
  _instance = createOutputManagerImpl(opts);
  return _instance;
}

export function getOutput(): OutputManager {
  if (!_instance) {
    throw new Error('OutputManager has not been initialized. Call createOutputManager() first.');
  }
  return _instance;
}

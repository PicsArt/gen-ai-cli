import type { ColorManager } from './color.ts';
import { getColor } from './color.ts';
import { renderCard } from './components/card.ts';
import { renderDivider } from './components/divider.ts';
import { sanitizeTerminalText, visibleWidth } from './components/string-utils.ts';
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

  // Untrusted strings (model names, drive metadata, provider messages) flow
  // into every decorated writer — scrub raw control bytes while keeping the
  // SGR/OSC 8 sequences the renderers themselves emit. result()/json() stay
  // raw: they are the machine-readable data contract.
  const clean = sanitizeTerminalText;

  // Decorated stdout output (tables, kv pairs) must not leak ANSI into a
  // redirected stdout — the color manager can stay enabled for stderr's TTY.
  function writeStdoutDecorated(text: string): void {
    writeStdout(process.stdout.isTTY ? text : color.strip(text));
  }

  return {
    result(data: string): void {
      writeStdout(data);
    },

    info(msg: string): void {
      if (quiet) return;
      const prefix = color.blue('i');
      writeStderr(`${prefix} ${clean(msg)}`);
    },

    success(msg: string): void {
      if (quiet) return;
      const prefix = color.green('✓');
      writeStderr(`${prefix} ${clean(msg)}`);
    },

    error(msg: string): void {
      const prefix = color.red('✗');
      writeStderr(`${prefix} ${clean(msg)}`);
    },

    debug(msg: string): void {
      if (!debugMode) return;
      const prefix = color.magenta('d');
      writeStderr(`${prefix} ${clean(msg)}`);
    },

    warn(msg: string): void {
      if (quiet) return;
      const prefix = color.yellow('!');
      writeStderr(`${prefix} ${clean(msg)}`);
    },

    json(data: unknown): void {
      writeStdout(JSON.stringify(data, null, 2));
    },

    table(rawRows: string[][], rawHeaders?: string[]): void {
      const rows = rawRows.map((row) => row.map(clean));
      const headers = rawHeaders?.map(clean);
      if (plainMode) {
        // Tab-separated in plain mode (cell tabs became spaces in clean())
        if (headers && headers.length > 0) {
          writeStdoutDecorated(headers.join('\t'));
        }
        for (const row of rows) {
          writeStdoutDecorated(row.join('\t'));
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
        writeStdoutDecorated(formatRow(boldHeaders));
        // Separator line
        const sep = colWidths.map((w) => '-'.repeat(w)).join('  ');
        writeStdoutDecorated(sep);
      }

      for (const row of rows) {
        writeStdoutDecorated(formatRow(row));
      }
    },

    kvPairs(pairs: [string, string][]): void {
      const cleaned = pairs.map(([k, v]) => [clean(k), clean(v)] as [string, string]);
      const keyWidth = cleaned.reduce((max, [k]) => Math.max(max, visibleWidth(k)), 0);

      for (const [key, value] of cleaned) {
        const paddedKey = color.bold(key) + ' '.repeat(keyWidth - visibleWidth(key));
        writeStdoutDecorated(`${paddedKey}  ${value}`);
      }
    },

    card(lines: string[], opts?: { title?: string; borderColor?: string }): void {
      const safeOpts = opts?.title != null ? { ...opts, title: clean(opts.title) } : opts;
      writeStderr(renderCard(lines.map(clean), { color, plain: plainMode, ...safeOpts }));
    },

    richTable(
      rows: Record<string, string>[],
      opts: { columns: { key: string; label?: string; align?: 'left' | 'right' | 'center' }[]; borderColor?: string },
    ): void {
      const safeRows = rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, clean(v)])));
      writeStdoutDecorated(renderTable(safeRows, { ...opts, color, plain: plainMode }));
    },

    divider(opts?: { label?: string }): void {
      writeStderr(renderDivider({ color, plain: plainMode, ...opts }));
    },
  };
}

let _instance: OutputManager | null = null;
let _quiet = false;

export function createOutputManager(opts: OutputManagerOptions): OutputManager {
  _instance = createOutputManagerImpl(opts);
  _quiet = opts.quiet;
  return _instance;
}

export function getOutput(): OutputManager {
  if (!_instance) {
    // Mirror getColor(): self-initialize with safe defaults instead of
    // throwing. Services (auth, authenticated-fetch) may log before a
    // command has primed the singleton — e.g. oclif built-in paths.
    _instance = createOutputManagerImpl({
      color: getColor(),
      quiet: false,
      debug: false,
      jsonMode: false,
      plainMode: false,
    });
  }
  return _instance;
}

/**
 * Whether the current invocation runs with --quiet. Safe to call before any
 * command initialized the OutputManager (returns false). Lets out-of-band
 * writers (e.g. the update notice, which bypasses OutputManager because it
 * also runs on oclif built-in paths) still honor the quiet contract.
 */
export function isQuietMode(): boolean {
  return _quiet;
}

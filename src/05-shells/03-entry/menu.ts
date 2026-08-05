/**
 * REPL `help` output — a flags reference, NOT a commands listing.
 *
 * Two cards:
 *   1. Flag Reference  — every flag from STATIC_FLAG_GROUPS + the Param
 *                        Surface catalog. Aliases, descriptions, enum
 *                        options, defaults, multi-valued indicators.
 *   2. Usage Examples  — curated short snippets showing common patterns
 *                        (short vs long flags, stdin/prompt-file, drive
 *                        save, dry-run, batch, etc.).
 *
 * The REPL entry banner already shows the commands list (Quick Start),
 * so this view focuses on "how do I use them" instead of repeating
 * "what commands exist."
 */

import { STATIC_FLAG_GROUPS } from '#flows';
import type { ColorManager } from '#infra/ui-core/color.ts';
import { renderCard } from '#infra/ui-core/components/card.ts';
import { generateFlagsFromCatalog, getCatalog } from '#param-surface';
import { OPERATIONS } from '#shells/03-entry/menu-registry.ts';

/**
 * Operation registry stays public — REPL shortcut resolver consumes it.
 *
 * Each subcommand is listed TWICE: once with a colon (oclif's canonical id,
 * matches what `--help` prints) and once with a space (more natural at the
 * REPL prompt). Both forms resolve to the same oclif command because
 * `run(['models:info', ...])` is invoked after we normalize the space form.
 */
export const UTILITY_COMMANDS = [
  'login',
  'logout',
  'whoami',
  'models',
  'models:info',
  'models info',
  'models:compare',
  'models compare',
  'pricing',
  'credits',
  'history',
  'history:last',
  'history last',
  'history:files',
  'history files',
  'history:clear',
  'history clear',
  'upload',
  'download',
  'list',
  'config',
  'config:get',
  'config get',
  'config:set',
  'config set',
  'config:list',
  'config list',
  'config:keys',
  'config keys',
  'config:unset',
  'config unset',
  'batch',
  'batch:run',
  'batch run',
  'batch:status',
  'batch status',
  'batch:resume',
  'batch resume',
  'validate',
  'update',
  'version',
  'completion',
  'dev:params',
];

export function getValidCommands(): string[] {
  return [...new Set([...OPERATIONS.map((op) => op.command), ...UTILITY_COMMANDS])];
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Help renderer — flag reference + usage examples                       */
/* ─────────────────────────────────────────────────────────────────────── */

interface OclifFlagShape {
  description?: string;
  char?: string;
  aliases?: readonly string[];
  options?: readonly string[];
  default?: unknown;
  multiple?: boolean;
  type?: string;
  hidden?: boolean;
}

interface FlagRow {
  flag: string;
  meta: OclifFlagShape;
}

function rowsFromRecord(rec: Record<string, unknown>): FlagRow[] {
  return Object.entries(rec)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([flag, meta]) => ({ flag, meta: meta as OclifFlagShape }))
    .filter((r) => !r.meta.hidden)
    .sort((a, b) => a.flag.localeCompare(b.flag));
}

function renderRow(row: FlagRow, color: ColorManager): string[] {
  const { flag, meta } = row;
  const lead = meta.char ? `-${meta.char}, ` : '    ';
  const names = [`--${flag}`, ...(meta.aliases ?? []).map((a) => `--${a}`)].join(', ');
  const argHint = meta.type === 'option' ? (meta.multiple ? ' <value>...' : ' <value>') : '';
  const header = `  ${color.bold((lead + names + argHint).padEnd(36))} ${meta.description ?? ''}`;
  const lines = [header];

  if (meta.options && meta.options.length > 0) {
    const preview = meta.options.slice(0, 8).join(', ');
    const more = meta.options.length > 8 ? color.dim(` (and ${meta.options.length - 8} more)`) : '';
    lines.push(`  ${' '.repeat(36)} ${color.dim(`options: ${preview}`)}${more}`);
  }
  if (meta.default !== undefined && meta.default !== false && meta.default !== '') {
    lines.push(`  ${' '.repeat(36)} ${color.dim(`default: ${meta.default}`)}`);
  }
  return lines;
}

function renderSection(title: string, rows: FlagRow[], color: ColorManager): string[] {
  if (rows.length === 0) return [];
  const lines: string[] = [color.dim(title)];
  for (const row of rows) lines.push(...renderRow(row, color));
  return lines;
}

/**
 * Render the full flag-reference + usage-examples view. The bare `help`
 * command in the REPL routes through here.
 *
 * Kept exported under its historic name (`renderOperationMenu`) so the
 * one caller in `repl.ts` doesn't need updating. The output content
 * changed; the entry point did not.
 */
export function renderOperationMenu(color: ColorManager): string {
  const universal = rowsFromRecord(STATIC_FLAG_GROUPS.universal as Record<string, unknown>);
  const output = rowsFromRecord(STATIC_FLAG_GROUPS.output as Record<string, unknown>);
  const model = rowsFromRecord(STATIC_FLAG_GROUPS.model as Record<string, unknown>);
  const promptIn = rowsFromRecord(STATIC_FLAG_GROUPS['prompt-input'] as Record<string, unknown>);
  const descriptor = rowsFromRecord(generateFlagsFromCatalog(getCatalog()));

  const lines: string[] = [];
  for (const block of [
    renderSection('Universal flags (every command)', universal, color),
    renderSection('Output', output, color),
    renderSection('Model selection', model, color),
    renderSection('Prompt source', promptIn, color),
    renderSection('Generation parameters (from the SDK descriptor catalog)', descriptor, color),
  ]) {
    if (block.length === 0) continue;
    if (lines.length > 0) lines.push('');
    lines.push(...block);
  }
  lines.push('');
  lines.push(
    color.dim(`  Type ${color.bold('<command> --help')} for the flags that apply to that command (model-filtered).`),
  );

  const flagCard = renderCard(lines, { color, title: 'Flag Reference' });
  return `${flagCard}\n${renderExamplesCard(color)}`;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Usage examples — curated, grouped by intent                           */
/* ─────────────────────────────────────────────────────────────────────── */

interface ExampleGroup {
  heading: string;
  rows: ReadonlyArray<{ cmd: string; note?: string }>;
}

const EXAMPLES: ReadonlyArray<ExampleGroup> = [
  {
    heading: 'Short vs long flags (any spelling works)',
    rows: [
      { cmd: 'gen-ai image -p "a sunset"' },
      { cmd: 'gen-ai image --prompt "a sunset"' },
      { cmd: 'gen-ai image -m flux-1.1-pro -p "neon city" --ar 16:9 -n 4' },
    ],
  },
  {
    heading: 'Prompt from stdin or file',
    rows: [{ cmd: 'echo "neon street at night" | gen-ai video' }, { cmd: 'gen-ai video --prompt-file ./prompt.txt' }],
  },
  {
    heading: 'Image inputs + output control',
    rows: [
      { cmd: 'gen-ai remove-bg -i ./photo.jpg' },
      { cmd: 'gen-ai change-bg -i ./photo.jpg -p "sunny beach" --drive-folder "Posters"' },
      { cmd: 'gen-ai enhance -i ./photo.jpg --no-save-to-drive --download ./out' },
    ],
  },
  {
    heading: 'Audio + video',
    rows: [
      { cmd: 'gen-ai music -p "lo-fi for studying" -d 60' },
      { cmd: 'gen-ai text-to-speech -p "hello world" --voice rachel' },
    ],
  },
  {
    heading: 'Scripting (silent + json)',
    rows: [
      { cmd: 'gen-ai image -p "..." -s --json | jq .resultUrl' },
      { cmd: 'gen-ai pricing flux-pro -d 5 --resolution 1080p --json' },
    ],
  },
  {
    heading: 'Discoverability',
    rows: [
      { cmd: 'gen-ai <command> --help', note: 'every flag, options, default — filtered to that command' },
      { cmd: 'gen-ai models', note: 'browse the live catalog' },
      { cmd: 'gen-ai dev:params', note: 'CLI ↔ SDK drift report' },
    ],
  },
];

function renderExamplesCard(color: ColorManager): string {
  const lines: string[] = [];
  for (const g of EXAMPLES) {
    if (lines.length > 0) lines.push('');
    lines.push(color.dim(g.heading));
    for (const r of g.rows) {
      const note = r.note ? `  ${color.dim(`# ${r.note}`)}` : '';
      lines.push(`  ${color.bold(r.cmd)}${note}`);
    }
  }
  return renderCard(lines, { color, title: 'Usage Examples', borderColor: '#8B8FA7' });
}

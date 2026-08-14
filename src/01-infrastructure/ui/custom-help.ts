/**
 * Card-based help renderer for the REPL.
 * Renders command help in styled cards instead of oclif's plain text.
 */

import { COMMANDS } from '#root/commands-manifest.ts';
import { createColorManager } from '../ui-core/color.ts';
import { renderCard } from '../ui-core/components/card.ts';

interface FlagMeta {
  char?: string;
  description?: string;
  default?: unknown;
  hidden?: boolean;
  aliases?: readonly string[];
  options?: readonly string[];
  multiple?: boolean;
}

interface CommandMeta {
  summary?: string;
  description?: string;
  flags?: Record<string, FlagMeta>;
  args?: Record<string, { description?: string; required?: boolean }>;
  examples?: Array<string | { command: string; description?: string }>;
}

function formatUsageArgs(args: Record<string, { required?: boolean }> | undefined): string {
  if (!args) return '';
  const parts: string[] = [];
  for (const [name, arg] of Object.entries(args)) {
    parts.push(arg.required ? name.toUpperCase() : `[${name.toUpperCase()}]`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/** Write a line to stdout with a trailing newline. */
function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

/**
 * Render one flag as a 2-row block:
 *
 *   -p, --prompt, --pr <value>      Generation prompt
 *                                   options: 16:9, 9:16, 1:1 (and 22 more)
 *                                   default: 0.5
 *
 * Aliases / enum options / default / multiple all surface here. Long
 * option lists are truncated with a "(and N more)" tail so the card
 * stays readable.
 */
function renderFlagRows(
  name: string,
  f: FlagMeta,
  color: { bold: (s: string) => string; dim: (s: string) => string },
): string[] {
  const lead = f.char ? `-${f.char}, ` : '    ';
  const names = [`--${name}`, ...(f.aliases ?? []).map((a) => `--${a}`)].join(', ');
  const tail = f.multiple ? ' <value>...' : '';
  const header = `  ${color.bold((lead + names + tail).padEnd(36))} ${f.description ?? ''}`;
  const rows = [header];

  if (f.options && f.options.length > 0) {
    const preview = f.options.slice(0, 6).join(', ');
    const more = f.options.length > 6 ? ` ${color.dim(`(and ${f.options.length - 6} more)`)}` : '';
    rows.push(`  ${' '.repeat(36)} ${color.dim(`options: ${preview}${more}`)}`);
  }
  // Only primitive defaults are printable — oclif allows functions/objects
  // as defaults, which would render as source code / [object Object].
  const d = f.default;
  if (
    d !== undefined &&
    d !== false &&
    d !== '' &&
    (typeof d === 'string' || typeof d === 'number' || typeof d === 'boolean')
  ) {
    rows.push(`  ${' '.repeat(36)} ${color.dim(`default: ${d}`)}`);
  }
  return rows;
}

/**
 * Show card-based help for a command. Returns true if the command was found.
 */
export function showCardHelp(commandId: string): boolean {
  // Resolve "models info" → "models:info", "config set" → "config:set", etc.
  const key = commandId.replace(/\s+/g, ':');
  const cmd = COMMANDS[key] as unknown as CommandMeta | undefined;
  if (!cmd) return false;

  const color = createColorManager({ enabled: 'auto' });

  const summary = cmd.summary ?? cmd.description?.split('\n')[0] ?? '';
  const description = cmd.description ?? '';
  const descLines = description.split('\n');
  const body = cmd.summary ? descLines.join('\n').trim() : descLines.slice(1).join('\n').trim();

  // ── Command card ──
  const headerLines: string[] = [`${color.bold(commandId)}  ${color.dim(summary)}`];
  if (body) {
    headerLines.push('');
    for (const text of body.split('\n')) {
      headerLines.push(text);
    }
  }
  line();
  line(renderCard(headerLines, { color, title: commandId }));

  // ── Usage card ──
  const usageLine = `$ gen-ai ${commandId}${formatUsageArgs(cmd.args as Record<string, { required?: boolean }> | undefined)}`;
  line(renderCard([usageLine], { color, title: 'Usage' }));

  // ── Flags card ──
  const flags = cmd.flags ?? {};
  const visibleFlags = Object.entries(flags)
    .filter(([, f]) => !f.hidden)
    .sort(([a], [b]) => a.localeCompare(b));

  if (visibleFlags.length > 0) {
    const flagLines = visibleFlags.flatMap(([name, f]) => renderFlagRows(name, f, color));
    line(renderCard(flagLines, { color, title: 'Flags' }));
  }

  // ── Examples card ──
  const examples = cmd.examples;
  if (examples && examples.length > 0) {
    const exampleLines: string[] = [];
    for (const ex of examples) {
      if (typeof ex === 'string') {
        const rendered = ex.replace(/<%= config\.bin %>/g, 'gen-ai');
        exampleLines.push(`  ${rendered}`);
      } else {
        exampleLines.push(color.dim(ex.description ?? ''));
        const rendered = ex.command.replace(/<%= config\.bin %>/g, 'gen-ai');
        exampleLines.push(`  ${rendered}`);
        exampleLines.push('');
      }
    }
    if (exampleLines[exampleLines.length - 1] === '') exampleLines.pop();
    line(renderCard(exampleLines, { color, title: 'Examples' }));
  }

  line();
  return true;
}

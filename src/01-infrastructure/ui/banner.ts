import { Models } from '@picsart/ai-sdk';
import { getColor } from '../ui-core/color.ts';
import { BRAND_GOLD } from './theme.ts';

// ASCII art — "PICSART" and "GEN AI" in block letters
const PICSART = [
  '██████╗ ██╗ ██████╗███████╗ █████╗ ██████╗ ████████╗',
  '██╔══██╗██║██╔════╝██╔════╝██╔══██╗██╔══██╗╚══██╔══╝',
  '██████╔╝██║██║     ███████╗███████║██████╔╝   ██║   ',
  '██╔═══╝ ██║██║     ╚════██║██╔══██║██╔══██╗   ██║   ',
  '██║     ██║╚██████╗███████║██║  ██║██║  ██║   ██║   ',
  '╚═╝     ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ',
];

const GEN_AI = [
  ' ██████╗ ███████╗███╗   ██╗      █████╗ ██╗',
  '██╔════╝ ██╔════╝████╗  ██║     ██╔══██╗██║',
  '██║  ███╗█████╗  ██╔██╗ ██║     ███████║██║',
  '██║   ██║██╔══╝  ██║╚██╗██║     ██╔══██║██║',
  '╚██████╔╝███████╗██║ ╚████║     ██║  ██║██║',
  ' ╚═════╝ ╚══════╝╚═╝  ╚═══╝     ╚═╝  ╚═╝╚═╝',
];

/** Write a line to stdout with a trailing newline. */
function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function printBanner(version: string, quiet = false): void {
  if (quiet) return;

  const color = getColor();
  const enabled = Models.list().filter((m) => !m.disabled);
  const vendorCount = new Set(enabled.map((m) => m.provider)).size;

  // Check if terminal is wide enough for the ASCII art
  const termWidth = process.stdout.columns || 80;
  if (termWidth < 60) {
    // Compact fallback for narrow terminals
    line();
    line(`  ${color.brand('Picsart gen-ai')} ${color.dim(`v${version}`)}`);
    line(`  ${color.dim(`${enabled.length} models \u00B7 ${vendorCount} providers`)}`);
    line();
    return;
  }

  const brandFn = color.hex(BRAND_GOLD);
  const borderFn = color.hex(BRAND_GOLD);

  // Find widest line for box sizing
  const allArt = [...PICSART, '', ...GEN_AI];
  const artWidth = Math.max(...allArt.map((l) => l.length));
  const infoLines = [`  v${version}`, `  ${enabled.length} models \u00B7 ${vendorCount} providers`];
  const contentWidth = Math.max(artWidth, ...infoLines.map((l) => l.length)) + 2;

  const top = borderFn(`\u250C${'\u2500'.repeat(contentWidth)}\u2510`);
  const bot = borderFn(`\u2514${'\u2500'.repeat(contentWidth)}\u2518`);
  const empty = borderFn('\u2502') + ' '.repeat(contentWidth) + borderFn('\u2502');

  const pad = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - text.length));

  line();
  line(top);
  for (const text of PICSART) {
    line(`${borderFn('\u2502')} ${brandFn(pad(text, contentWidth - 1))}${borderFn('\u2502')}`);
  }
  line(empty);
  for (const text of GEN_AI) {
    line(`${borderFn('\u2502')} ${brandFn(pad(text, contentWidth - 1))}${borderFn('\u2502')}`);
  }
  line(empty);
  for (const text of infoLines) {
    line(`${borderFn('\u2502')} ${color.dim(pad(text, contentWidth - 1))}${borderFn('\u2502')}`);
  }
  line(empty);
  line(bot);
  line();
}

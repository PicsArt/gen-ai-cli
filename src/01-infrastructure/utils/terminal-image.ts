/**
 * Inline image preview for terminals that support iTerm2 or Kitty protocols.
 * Falls back to a text summary (filename + dimensions) on unsupported terminals.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';

type Protocol = 'iterm2' | 'kitty' | 'none';

let cachedProtocol: Protocol | undefined;

/** Detect which inline image protocol the terminal supports. */
export function detectProtocol(): Protocol {
  if (cachedProtocol) return cachedProtocol;

  // When stdout is piped (e.g. spawned by an MCP server), escape sequences
  // won't be rendered and just bloat the output — skip image previews entirely.
  if (!process.stdout.isTTY) {
    cachedProtocol = 'none';
    return cachedProtocol;
  }

  const term = process.env.TERM_PROGRAM ?? '';
  const termEnv = process.env.TERM ?? '';

  // iTerm2 protocol — supported by iTerm2, WezTerm, Hyper, VSCode, Tabby, Rio
  if (
    term === 'iTerm.app' ||
    term === 'WezTerm' ||
    term === 'vscode' ||
    term === 'Tabby' ||
    term === 'rio' ||
    process.env.ITERM_SESSION_ID ||
    process.env.VSCODE_PID // VSCode integrated terminal
  ) {
    cachedProtocol = 'iterm2';
    return cachedProtocol;
  }

  // Kitty protocol
  if (term === 'kitty' || termEnv.includes('kitty')) {
    cachedProtocol = 'kitty';
    return cachedProtocol;
  }

  // Sixel terminals (mintty, mlterm, xterm with sixel) are intentionally NOT
  // detected: renderInline has no sixel encoder, so advertising support would
  // just download the image and then print the "unavailable" fallback.

  cachedProtocol = 'none';
  return cachedProtocol;
}

/** Render an image inline in the terminal from a file path or buffer. */
export function renderInline(input: string | Buffer, opts?: { width?: number; height?: number; label?: string }): void {
  const protocol = detectProtocol();
  const data = typeof input === 'string' ? fs.readFileSync(input) : input;
  const b64 = data.toString('base64');
  const width = opts?.width ?? 40;
  const height = opts?.height ?? 'auto';

  if (protocol === 'iterm2') {
    // ESC ] 1337 ; File = [args] : base64 ST
    const args = `inline=1;width=${width};height=${height};preserveAspectRatio=1`;
    const name = opts?.label ? `;name=${Buffer.from(opts.label).toString('base64')}` : '';
    process.stdout.write(`\x1b]1337;File=${args}${name}:${b64}\x07\n`);
    return;
  }

  if (protocol === 'kitty') {
    // Kitty graphics protocol: send in chunks of 4096 bytes
    const CHUNK = 4096;
    for (let i = 0; i < b64.length; i += CHUNK) {
      const chunk = b64.slice(i, i + CHUNK);
      const more = i + CHUNK < b64.length ? 1 : 0;
      if (i === 0) {
        process.stdout.write(`\x1b_Gf=100,a=T,t=d,C=1,c=${width},m=${more};${chunk}\x1b\\`);
      } else {
        process.stdout.write(`\x1b_Gm=${more};${chunk}\x1b\\`);
      }
    }
    process.stdout.write('\n');
    return;
  }

  // Fallback: terminal does not support inline images — print a one-line
  // summary to stderr (UI chrome; stdout may be piped and must stay clean).
  const label = opts?.label ?? (typeof input === 'string' ? input : 'image');
  const sizeKb = (data.length / 1024).toFixed(1);
  process.stderr.write(`${label}: ${sizeKb} KB (image preview unavailable in this terminal)\n`);
}

/** Preview an image from a URL — downloads first, then renders inline. */
export async function previewUrl(url: string, label?: string): Promise<void> {
  const protocol = detectProtocol();
  if (protocol === 'none') {
    return;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    renderInline(buf, { width: 40, label: label ?? 'result' });
  } catch {
    // Silent fail — preview is optional
  }
}

/** Preview a local file. */
export function previewFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  renderInline(filePath, { label: filePath });
}

/** Check if inline image preview is supported in this terminal. */
export function supportsInlineImages(): boolean {
  return detectProtocol() !== 'none';
}

/** Get image dimensions using `sips` (macOS) or `identify` (ImageMagick). */
export function getImageDimensions(filePath: string): { width: number; height: number } | null {
  try {
    if (process.platform === 'darwin') {
      const result = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const w = result.stdout?.match(/pixelWidth:\s*(\d+)/)?.[1];
      const h = result.stdout?.match(/pixelHeight:\s*(\d+)/)?.[1];
      if (w && h) return { width: Number.parseInt(w, 10), height: Number.parseInt(h, 10) };
    } else {
      const result = spawnSync('identify', ['-format', '%w %h', filePath], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const [w, h] = (result.stdout ?? '').trim().split(' ').map(Number);
      if (w && h) return { width: w, height: h };
    }
  } catch {
    /* tool not available */
  }
  return null;
}

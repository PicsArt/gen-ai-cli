/**
 * Output download — save result files to local filesystem.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OutputDeps } from '#root/deps.ts';
import { resolveUserPath } from '#services/constants.ts';

/**
 * Download a URL to a local directory.
 * Creates the directory if it doesn't exist.
 */
export async function downloadToDir(url: string, dir: string, deps: OutputDeps): Promise<string> {
  const resolvedDir = resolveUserPath(dir);
  const parsed = new URL(url);
  const rawName = path.basename(parsed.pathname) || 'output';
  // eslint-disable-next-line no-control-regex
  const filename = rawName.replace(/[<>:"|?*\u0000-\u001f]/g, '_') || 'output';
  const outPath = path.join(resolvedDir, filename);

  fs.mkdirSync(resolvedDir, { recursive: true });
  deps.out.info(`Downloading to ${outPath}...`);

  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(buf));
  deps.out.success(`Saved: ${outPath}`);
  return outPath;
}

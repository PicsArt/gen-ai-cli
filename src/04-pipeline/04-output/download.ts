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
  fs.mkdirSync(resolvedDir, { recursive: true });

  // Multi-result generations (and re-runs into the same dir) often share a
  // URL basename — never clobber an existing file, suffix instead.
  let outPath = path.join(resolvedDir, filename);
  if (fs.existsSync(outPath)) {
    const ext = path.extname(filename);
    const stem = filename.slice(0, filename.length - ext.length);
    for (let i = 1; ; i++) {
      const candidate = path.join(resolvedDir, `${stem}-${i}${ext}`);
      if (!fs.existsSync(candidate)) {
        outPath = candidate;
        break;
      }
    }
  }
  deps.out.info(`Downloading to ${outPath}...`);

  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(buf));
  deps.out.success(`Saved: ${outPath}`);
  return outPath;
}

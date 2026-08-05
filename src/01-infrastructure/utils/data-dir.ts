/**
 * Filesystem location for gen-ai CLI's local data (~/.gen-ai).
 *
 * Pure infrastructure: depends only on Node built-ins. Services and
 * commands import this when they need to read or persist local files.
 */
import fs from 'node:fs';
import os from 'node:os';

/** Root data directory for gen-ai CLI (~/.gen-ai). */
export function getDataDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return `${home}/.gen-ai`;
}

/** Ensure the data directory exists. Idempotent. */
export function ensureDataDir(): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

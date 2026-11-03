/**
 * On-disk cache of the models-hub catalog — ~/.gen-ai/catalog-cache/<hash>.json,
 * one file per catalog URL (so stage and prod, or different filters, never
 * share an entry). Holds the raw response text plus what is needed to reuse
 * it (`max-age`) and to revalidate it (`ETag`). Every read and write is
 * best-effort: a missing, corrupt or unwritable cache only means a fetch.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDataDir, getDataDir } from '#infra/utils/data-dir.ts';

export interface CachedCatalog {
  url: string;
  /** Raw response body, exactly as models-hub sent it. */
  body: string;
  etag: string | null;
  /** Epoch ms of the last 200 or 304 from the server. */
  fetchedAt: number;
  /** From the response's `Cache-Control: max-age`. */
  maxAgeMs: number;
}

/** Used when the server sends no `max-age` — models-hub currently sends 300 s. */
export const DEFAULT_CATALOG_MAX_AGE_MS = 5 * 60_000;

export function catalogCachePath(url: string): string {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return path.join(getDataDir(), 'catalog-cache', `${key}.json`);
}

/** `max-age` from a Cache-Control header, in ms; the default when absent or malformed. */
export function parseMaxAgeMs(cacheControl: string | null): number {
  const match = cacheControl?.match(/(?:^|[,\s])max-age=(\d+)/i);
  return match ? Number(match[1]) * 1000 : DEFAULT_CATALOG_MAX_AGE_MS;
}

export function isCacheFresh(entry: CachedCatalog, now: number = Date.now()): boolean {
  return now - entry.fetchedAt < entry.maxAgeMs;
}

export function readCatalogCache(url: string): CachedCatalog | null {
  try {
    const entry = JSON.parse(fs.readFileSync(catalogCachePath(url), 'utf-8')) as Partial<CachedCatalog>;
    if (
      entry.url !== url ||
      typeof entry.body !== 'string' ||
      typeof entry.fetchedAt !== 'number' ||
      typeof entry.maxAgeMs !== 'number'
    ) {
      return null;
    }
    return { url, body: entry.body, etag: entry.etag ?? null, fetchedAt: entry.fetchedAt, maxAgeMs: entry.maxAgeMs };
  } catch {
    return null;
  }
}

/** Write via a temp file + rename so a concurrent reader never sees half a file. */
export function writeCatalogCache(entry: CachedCatalog): void {
  try {
    ensureDataDir();
    const file = catalogCachePath(entry.url);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    /* best-effort — the next run fetches again */
  }
}

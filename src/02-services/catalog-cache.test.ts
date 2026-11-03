import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type CachedCatalog,
  catalogCachePath,
  DEFAULT_CATALOG_MAX_AGE_MS,
  isCacheFresh,
  parseMaxAgeMs,
  readCatalogCache,
  writeCatalogCache,
} from './catalog-cache.ts';

const URL_A = 'https://api.example.com/gw-v2/v1/models-catalog?include=schema';
const URL_B = 'https://stage.example.com/gw-v2/v1/models-catalog?include=schema';

let home: string;
const originalHome = process.env.HOME;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-catalog-cache-'));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

const entry = (over: Partial<CachedCatalog> = {}): CachedCatalog => ({
  url: URL_A,
  body: '{"status":"success"}',
  etag: 'W/"abc"',
  fetchedAt: 1_000,
  maxAgeMs: 300_000,
  ...over,
});

describe('catalog-cache', () => {
  it('round-trips an entry under ~/.gen-ai/catalog-cache', () => {
    writeCatalogCache(entry());
    expect(catalogCachePath(URL_A).startsWith(path.join(home, '.gen-ai', 'catalog-cache'))).toBe(true);
    expect(readCatalogCache(URL_A)).toEqual(entry());
  });

  it('keys entries by URL so environments never share one', () => {
    writeCatalogCache(entry());
    expect(catalogCachePath(URL_A)).not.toBe(catalogCachePath(URL_B));
    expect(readCatalogCache(URL_B)).toBeNull();
  });

  it('treats a missing or corrupt file as no cache', () => {
    expect(readCatalogCache(URL_A)).toBeNull();
    fs.mkdirSync(path.dirname(catalogCachePath(URL_A)), { recursive: true });
    fs.writeFileSync(catalogCachePath(URL_A), '{not json');
    expect(readCatalogCache(URL_A)).toBeNull();
  });

  it('parses max-age, defaulting when absent', () => {
    expect(parseMaxAgeMs('public, max-age=300, stale-while-revalidate=3600')).toBe(300_000);
    expect(parseMaxAgeMs('max-age=60')).toBe(60_000);
    expect(parseMaxAgeMs(null)).toBe(DEFAULT_CATALOG_MAX_AGE_MS);
    expect(parseMaxAgeMs('no-cache')).toBe(DEFAULT_CATALOG_MAX_AGE_MS);
  });

  it('is fresh only within max-age', () => {
    expect(isCacheFresh(entry(), 1_000 + 299_999)).toBe(true);
    expect(isCacheFresh(entry(), 1_000 + 300_000)).toBe(false);
  });
});

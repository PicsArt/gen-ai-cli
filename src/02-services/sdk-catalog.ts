/**
 * Boot-time model catalog: dynamic (models-hub) by default, bundled as fallback.
 *
 * In dynamic mode the SDK loads models, params and constraints from
 * `${apiUrl}/gw-v2/v1/models-catalog` and sends every generation as
 * `{ model, params }` to the `v1/models` workflow, where the server builds
 * the vendor payload. New models and params reach the CLI without an SDK
 * bump or a CLI release.
 *
 * `bootSdkCatalog()` runs once per process, before oclif reads any command's
 * flags (they are composed from the catalog). It fixes the mode and installs
 * the catalog:
 *
 *   GEN_AI_SDK_MODE=static          → static, no request
 *   fresh disk cache (max-age)      → dynamic, no request
 *   logged in                       → dynamic, conditional GET (ETag, 4 s cap) → cache
 *   request fails / times out /
 *   not logged in / token expired   → dynamic from a stale cache (≤ 7 days)
 *   token expired, no usable cache  → refresh the token, then the GET above
 *   nothing usable                  → static (the bundled catalog)
 *
 * The fallback must be decided BEFORE a dynamic client exists: creating one
 * marks the SDK's process-global catalog pending, after which the bundle can
 * never be reinstalled. So the body is fetched and validated first, and only
 * then handed to the SDK through a fetch that serves it from memory.
 *
 * `allModels()` replaces the SDK's `ALL_MODELS` constant, which is always the
 * bundle. `findModel` / `getModel` / `Model()` / `catalog.*` already follow
 * the installed catalog.
 */
import {
  ALL_MODELS,
  type GenerationMode,
  getModel,
  isVisibleForReleases,
  type ModelCatalogFilters,
  type ModelDefinition,
  type SdkMode,
} from '@picsart/ai-sdk';
import { type Credentials, getEnvCredentials, loadCredentials, refreshAccessToken } from '#services/auth.ts';
import {
  type CachedCatalog,
  isCacheFresh,
  parseMaxAgeMs,
  readCatalogCache,
  writeCatalogCache,
} from '#services/catalog-cache.ts';
import { createSdkClient } from '#services/client.ts';
import { getApiUrl, makeHeaders } from '#services/constants.ts';
import { isDynamicSdk, isSdkModeResolved, requestedSdkMode, setSdkMode } from '#services/sdk-mode.ts';

const CATALOG_PATH = '/gw-v2/v1/models-catalog';

/**
 * Everything the bundle carries: previews (hidden from generation by
 * `modelAvailable`, listed by `models --all`) and deprecated ids (so a
 * retired model still resolves to "unavailable" rather than "unknown").
 */
const CATALOG_FILTERS: ModelCatalogFilters = {
  release: ['production', 'general-availability', 'preview'],
  includeDeprecated: true,
};

/**
 * Boot must not hang a command on a slow gateway; past this, a stale cache or
 * the bundle serves. Covers the catalog request and its body — a token
 * refresh is never under it (see `loadCatalogBody`).
 */
const CATALOG_FETCH_TIMEOUT_MS = 4000;

/** Older than this, a cache is no better than the bundle that shipped with this CLI. */
const STALE_CACHE_LIMIT_MS = 7 * 24 * 60 * 60_000;

export type CatalogSource = 'bundled' | 'cache' | 'network' | 'stale-cache';

export interface SdkBootInfo {
  mode: SdkMode;
  source: CatalogSource;
  /** Number of models installed. */
  models: number;
  /** Why boot fell back to the bundle or a stale cache. */
  reason?: string;
}

/** The catalog URL — also the cache key. */
export function catalogUrl(apiUrl: string): string {
  const query = new URLSearchParams({ include: 'schema,constraints,routing' });
  const release = CATALOG_FILTERS.release;
  if (release) query.set('release', Array.isArray(release) ? release.join(',') : release);
  if (CATALOG_FILTERS.includeDeprecated) query.set('includeDeprecated', 'true');
  return `${apiUrl.replace(/\/+$/, '')}${CATALOG_PATH}?${query}`;
}

/**
 * The model ids in a models-catalog body, or null when it is not one. Mirrors
 * the SDK's own `deserializeCatalog` check so a bad body is caught while the
 * bundle is still installable.
 */
export function catalogModelIds(body: string): string[] | null {
  try {
    const json = JSON.parse(body) as { status?: unknown; response?: { models?: unknown } };
    const models = json?.status === 'success' ? json.response?.models : undefined;
    if (!Array.isArray(models) || models.length === 0) return null;
    const ids: string[] = [];
    for (const m of models as { id?: unknown; provider?: unknown }[]) {
      if (typeof m?.id !== 'string' || !m.provider) return null;
      ids.push(m.id);
    }
    return ids;
  } catch {
    return null;
  }
}

interface LoadedBody {
  body: string;
  ids: string[];
  source: Exclude<CatalogSource, 'bundled'>;
  reason?: string;
}

/** A cache entry whose body is a usable catalog. */
interface ValidCache {
  entry: CachedCatalog;
  ids: string[];
}

/**
 * The cache entry, only if its body parses as a catalog. An unusable entry is
 * dropped here — before its ETag could be sent — or a 304 would keep handing
 * back the same broken body on every run.
 */
function readValidCache(url: string): ValidCache | null {
  const entry = readCatalogCache(url);
  const ids = entry ? catalogModelIds(entry.body) : null;
  return entry && ids ? { entry, ids } : null;
}

function storedCredentials(): Credentials | null {
  return getEnvCredentials() ?? loadCredentials();
}

/** Same 60 s buffer as `getToken()`. Env tokens carry no usable expiry. */
function tokenExpired(creds: Credentials, now: number): boolean {
  return !getEnvCredentials() && new Date(creds.expiresAt).getTime() <= now + 60_000;
}

function usableStale(cached: ValidCache | null, reason: string, now: number): LoadedBody | null {
  if (!cached || now - cached.entry.fetchedAt > STALE_CACHE_LIMIT_MS) return null;
  return { body: cached.entry.body, ids: cached.ids, source: 'stale-cache', reason };
}

/**
 * The catalog body per the cache/revalidate/fallback order in the header, or
 * null + why not.
 *
 * A token refresh is never abandoned or aborted: the server rotates the refresh
 * token, so dropping a refresh mid-flight can lose the rotated one (logging the
 * user out), and one left running past boot can rewrite credentials after the
 * command — `logout`, say — has started. So boot refreshes only when it must
 * (expired token, no usable cache) and then waits for it, exactly as the
 * command's own `getToken()` would a moment later. The catalog request itself
 * never refreshes: a 401 is a failed request like any other.
 */
async function loadCatalogBody(url: string, now: number): Promise<LoadedBody | { reason: string }> {
  const cached = readValidCache(url);
  if (cached && isCacheFresh(cached.entry, now)) return { body: cached.entry.body, ids: cached.ids, source: 'cache' };

  let creds = storedCredentials();
  if (!creds) {
    const reason = 'not logged in';
    return usableStale(cached, reason, now) ?? { reason };
  }
  if (tokenExpired(creds, now)) {
    const stale = usableStale(cached, 'access token expired', now);
    if (stale) return stale;
    try {
      creds = await refreshAccessToken();
    } catch (err) {
      return { reason: `token refresh failed (${err instanceof Error ? err.message : String(err)})` };
    }
  }

  const fetched = await fetchCatalogBody(url, creds, cached, now);
  if ('body' in fetched) return fetched;
  const reason = `catalog request failed (${fetched.reason})`;
  return usableStale(cached, reason, now) ?? { reason };
}

/** One conditional GET under the boot deadline; a 304 refreshes the cached entry's age. */
async function fetchCatalogBody(
  url: string,
  creds: Credentials,
  cached: ValidCache | null,
  now: number,
): Promise<LoadedBody | { reason: string }> {
  const signal = AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS);
  const headers: Record<string, string> = makeHeaders(creds.token, creds.uid);
  if (cached?.entry.etag) headers['If-None-Match'] = cached.entry.etag;
  let res: Response;
  let body: string;
  try {
    res = await fetch(url, { method: 'GET', headers, signal });
    body = res.status === 304 ? '' : await res.text();
  } catch (err) {
    return {
      reason: signal.aborted ? `timed out after ${CATALOG_FETCH_TIMEOUT_MS} ms` : String((err as Error).message ?? err),
    };
  }
  const maxAgeMs = parseMaxAgeMs(res.headers.get('cache-control'));
  if (res.status === 304 && cached) {
    writeCatalogCache({ ...cached.entry, fetchedAt: now, maxAgeMs });
    return { body: cached.entry.body, ids: cached.ids, source: 'cache' };
  }
  if (!res.ok) return { reason: `HTTP ${res.status}` };
  const ids = catalogModelIds(body);
  if (!ids) return { reason: 'malformed catalog response' };
  writeCatalogCache({ url, body, etag: res.headers.get('etag'), fetchedAt: now, maxAgeMs });
  return { body, ids, source: 'network' };
}

let _boot: Promise<SdkBootInfo> | null = null;
let _info: SdkBootInfo | null = null;
let _loadedIds: readonly string[] | null = null;
let _allModels: readonly ModelDefinition[] | null = null;

function finishStatic(reason?: string): SdkBootInfo {
  setSdkMode('static');
  _info = { mode: 'static', source: 'bundled', models: ALL_MODELS.length, ...(reason ? { reason } : {}) };
  return _info;
}

/**
 * Fix the SDK mode and install the catalog. Idempotent: concurrent and repeat
 * calls share one boot. Never throws for a missing or unreachable catalog —
 * those fall back as described in the header.
 */
export function bootSdkCatalog(): Promise<SdkBootInfo> {
  _boot ??= (async () => {
    if (isSdkModeResolved() && !isDynamicSdk()) return finishStatic();
    if (requestedSdkMode() === 'static') return finishStatic('GEN_AI_SDK_MODE=static');

    const apiUrl = getApiUrl();
    const loaded = await loadCatalogBody(catalogUrl(apiUrl), Date.now());
    if (!('body' in loaded)) return finishStatic(loaded.reason);

    setSdkMode('dynamic');
    // The SDK only installs a catalog it fetched itself; hand it the body we
    // already have instead of a second request.
    const body = loaded.body;
    const installer = createSdkClient({
      apiUrl,
      fetch: async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    await installer.initModelCatalog({ filtersOptions: CATALOG_FILTERS });
    _loadedIds = loaded.ids;
    _allModels = null;
    _info = {
      mode: 'dynamic',
      source: loaded.source,
      models: loaded.ids.length,
      ...(loaded.reason ? { reason: loaded.reason } : {}),
    };
    return _info;
  })();
  return _boot;
}

/** What boot did, or null before it ran. */
export function getSdkBootInfo(): SdkBootInfo | null {
  return _info;
}

/**
 * Every model in the active catalog, deprecated and preview included — the
 * mode-aware `ALL_MODELS`. Filter with `modelAvailable` / `isVisibleForReleases`
 * exactly as before.
 */
export function allModels(): readonly ModelDefinition[] {
  if (!isDynamicSdk() || !_loadedIds) return ALL_MODELS;
  _allModels ??= _loadedIds.map((id) => getModel(id)).filter((m): m is ModelDefinition => m !== undefined);
  return _allModels;
}

/** The mode-aware `getModelsByMode` (the SDK's reads the bundle). */
export function modelsByMode(mode: GenerationMode, includeHidden = false): ModelDefinition[] {
  return allModels().filter((m) => m.mode === mode && (includeHidden || isVisibleForReleases(m)));
}

/** Test-only: forget the boot. Pair with `resetSdkModeForTests()`. */
export function resetSdkCatalogForTests(): void {
  _boot = null;
  _info = null;
  _loadedIds = null;
  _allModels = null;
}

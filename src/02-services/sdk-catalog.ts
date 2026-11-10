/**
 * Boot-time model catalog, loaded from models-hub.
 *
 * `@picsart/ai-sdk` 7 ships no catalog: models, params and constraints come
 * from `${apiUrl}/gw-v2/v1/models-catalog`, and every generation is sent as
 * `{ model, params }` to the `v1/models` workflow, where the server builds the
 * vendor payload. New models and params reach the CLI without an SDK bump or a
 * CLI release. Every SDK model read (`findModel`, `getModel`, `Model()`,
 * `catalog.*`) throws `catalog_not_loaded` until a catalog is installed.
 *
 * `bootSdkCatalog()` runs once per process, before oclif reads any command's
 * flags (they are composed from the catalog), and installs the first of:
 *
 *   fresh disk cache (max-age)      → no request
 *   logged in                       → conditional GET (ETag, 4 s cap) → cache
 *   request fails / times out /
 *   not logged in / token expired   → the cache, however old
 *   token expired, no cache         → refresh the token, then the GET above
 *   nothing usable                  → no catalog: commands that need one fail
 *                                     with `requireCatalog()`'s error, the rest
 *                                     (login, config, drive, …) run as usual
 *
 * The catalog endpoint needs a signed-in user (401 otherwise), so a first run
 * before `gen-ai login` has no catalog until the user logs in.
 *
 * `GEN_AI_CATALOG_FILE=<path>` installs a saved models-catalog response
 * instead, with no request — for tests and offline CI (the checked-in
 * `test-fixtures/models-catalog.snapshot.json`).
 *
 * `allModels()` replaces the SDK's removed `ALL_MODELS`: `catalog.all()` hides
 * deprecated models, and the CLI still needs them to say "unavailable" rather
 * than "unknown".
 */
import { readFileSync } from 'node:fs';
import {
  type GenerationMode,
  getModel,
  isVisibleForReleases,
  type ModelCatalogFilters,
  type ModelDefinition,
} from '@picsart/ai-sdk';
import { AuthError } from '#infra/errors/auth.ts';
import type { CliError } from '#infra/errors/base.ts';
import { isNetworkError, NetworkError } from '#infra/errors/network.ts';
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
import { installedCatalogIds, setInstalledCatalogIds } from '#services/installed-catalog.ts';

const CATALOG_PATH = '/gw-v2/v1/models-catalog';

/**
 * Every tier the CLI can show: previews (hidden from generation by
 * `modelAvailable`, listed by `models --all`) and deprecated ids (so a retired
 * model still resolves to "unavailable" rather than "unknown").
 */
const CATALOG_FILTERS: ModelCatalogFilters = {
  release: ['production', 'general-availability', 'preview'],
  includeDeprecated: true,
};

/**
 * Boot must not hang a command on a slow gateway; past this, the cache serves.
 * Covers the catalog request and its body — a token refresh is never under it
 * (see `loadCatalogBody`).
 */
const CATALOG_FETCH_TIMEOUT_MS = 4000;

export type CatalogSource = 'cache' | 'network' | 'stale-cache' | 'file';

export interface SdkBootInfo {
  /** Where the installed catalog came from; null when none could be loaded. */
  source: CatalogSource | null;
  /** Number of models installed. */
  models: number;
  /** Why boot used a stale cache or loaded nothing. */
  reason?: string;
  /** No catalog because the user must log in (vs. a network or server failure). */
  needsLogin?: boolean;
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
 * the SDK's own `deserializeCatalog` check so a bad body is never cached.
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
  source: CatalogSource;
  reason?: string;
}

interface NoBody {
  reason: string;
  needsLogin?: boolean;
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

/** With no bundled catalog to fall back on, any cached catalog beats none. */
function stale(cached: ValidCache | null, reason: string): LoadedBody | null {
  return cached ? { body: cached.entry.body, ids: cached.ids, source: 'stale-cache', reason } : null;
}

/**
 * The catalog body per the cache/revalidate/fallback order in the header, or
 * why there is none.
 *
 * A token refresh is never abandoned or aborted: the server rotates the refresh
 * token, so dropping a refresh mid-flight can lose the rotated one (logging the
 * user out), and one left running past boot can rewrite credentials after the
 * command — `logout`, say — has started. So boot refreshes only when it must
 * (expired token, no cache) and then waits for it, exactly as the command's own
 * `getToken()` would a moment later. The catalog request itself never
 * refreshes: a 401 is a failed request like any other.
 */
async function loadCatalogBody(url: string, now: number): Promise<LoadedBody | NoBody> {
  const cached = readValidCache(url);
  if (cached && isCacheFresh(cached.entry, now)) return { body: cached.entry.body, ids: cached.ids, source: 'cache' };

  let creds = storedCredentials();
  if (!creds) {
    const reason = 'not logged in';
    return stale(cached, reason) ?? { reason, needsLogin: true };
  }
  if (tokenExpired(creds, now)) {
    const usable = stale(cached, 'access token expired');
    if (usable) return usable;
    try {
      creds = await refreshAccessToken();
    } catch (err) {
      // Same split as `getToken()`: an unreachable auth server is a network
      // failure, not a reason to log in again.
      const reason = `token refresh failed (${err instanceof Error ? err.message : String(err)})`;
      return isNetworkError(err) ? { reason } : { reason, needsLogin: true };
    }
  }

  const fetched = await fetchCatalogBody(url, creds, cached, now);
  if ('body' in fetched) return fetched;
  const reason = `catalog request failed (${fetched.reason})`;
  return stale(cached, reason) ?? { reason, ...(fetched.status === 401 ? { needsLogin: true } : {}) };
}

/** One conditional GET under the boot deadline; a 304 refreshes the cached entry's age. */
async function fetchCatalogBody(
  url: string,
  creds: Credentials,
  cached: ValidCache | null,
  now: number,
): Promise<LoadedBody | { reason: string; status?: number }> {
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
  if (!res.ok) return { reason: `HTTP ${res.status}`, status: res.status };
  const ids = catalogModelIds(body);
  if (!ids) return { reason: 'malformed catalog response' };
  writeCatalogCache({ url, body, etag: res.headers.get('etag'), fetchedAt: now, maxAgeMs });
  return { body, ids, source: 'network' };
}

/** The `GEN_AI_CATALOG_FILE` catalog — never falls through to the network. */
function loadCatalogFile(file: string): LoadedBody | NoBody {
  let body: string;
  try {
    body = readFileSync(file, 'utf8');
  } catch (err) {
    return { reason: `GEN_AI_CATALOG_FILE unreadable (${(err as Error).message})` };
  }
  const ids = catalogModelIds(body);
  return ids ? { body, ids, source: 'file' } : { reason: `GEN_AI_CATALOG_FILE is not a models-catalog response` };
}

/**
 * A boot that loaded nothing for a network or server reason is retried by
 * `ensureCatalog()` only once this much time has passed — long enough that a
 * one-shot command never waits out a second timeout right after the first.
 */
const CATALOG_RETRY_AFTER_MS = 30_000;

let _boot: Promise<SdkBootInfo> | null = null;
let _bootAt = 0;
let _info: SdkBootInfo | null = null;
let _allModels: readonly ModelDefinition[] | null = null;
let _allModelsFor: readonly string[] | null = null;

/**
 * Install a models-catalog body (already validated by `catalogModelIds`) as
 * the SDK's process-global catalog. The SDK only installs a catalog it fetched
 * itself, so it is handed the body through a fetch that serves it from memory.
 * Also how test setup installs the checked-in snapshot.
 */
export async function installCatalogBody(body: string, ids: readonly string[]): Promise<void> {
  const installer = createSdkClient({
    apiUrl: getApiUrl(),
    fetch: async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await installer.initModelCatalog({ filtersOptions: CATALOG_FILTERS });
  setInstalledCatalogIds(ids);
}

/**
 * Load and install the catalog. Idempotent: concurrent and repeat calls share
 * one boot. Never throws — a missing or unreachable catalog is recorded and
 * surfaces only in commands that need it (`requireCatalog()`).
 */
export function bootSdkCatalog(): Promise<SdkBootInfo> {
  _boot ??= (async () => {
    _bootAt = Date.now();
    const file = process.env.GEN_AI_CATALOG_FILE;
    const loaded = file ? loadCatalogFile(file) : await loadCatalogBody(catalogUrl(getApiUrl()), Date.now());
    if (!('body' in loaded)) {
      _info = { source: null, models: 0, reason: loaded.reason, ...(loaded.needsLogin ? { needsLogin: true } : {}) };
      return _info;
    }
    await installCatalogBody(loaded.body, loaded.ids);
    _info = { source: loaded.source, models: loaded.ids.length, ...(loaded.reason ? { reason: loaded.reason } : {}) };
    return _info;
  })();
  return _boot;
}

/** What boot did, or null before it ran. */
export function getSdkBootInfo(): SdkBootInfo | null {
  return _info;
}

export function isCatalogLoaded(): boolean {
  return installedCatalogIds() !== null;
}

/** The error a command that needs the catalog fails with when boot loaded none. */
export function catalogUnavailableError(): CliError {
  const reason = _info?.reason ?? 'not loaded';
  if (_info?.needsLogin) return new AuthError(`the model catalog needs a signed-in user (${reason}).`);
  const err = new NetworkError(`could not load the model catalog (${reason}).`);
  err.hint = 'Check your connection and try again. The catalog is cached after the first successful load.';
  return err;
}

/** Throw `catalogUnavailableError()` unless a catalog is installed. */
export function requireCatalog(): void {
  if (!isCatalogLoaded()) throw catalogUnavailableError();
}

/**
 * `requireCatalog()` for a command about to run. A boot that loaded nothing is
 * retried — the REPL boots once and may outlive the cause:
 *   - failed for want of a login → as soon as credentials exist (the user ran
 *     `login` in the REPL);
 *   - failed for any other reason (offline, timeout, 5xx) → once
 *     `CATALOG_RETRY_AFTER_MS` has passed since that attempt.
 */
export async function ensureCatalog(): Promise<void> {
  if (isCatalogLoaded()) return;
  const retry = _info?.needsLogin
    ? storedCredentials() !== null
    : _info !== null && Date.now() - _bootAt >= CATALOG_RETRY_AFTER_MS;
  if (retry) {
    _boot = null;
    await bootSdkCatalog();
  }
  requireCatalog();
}

/**
 * Every model in the installed catalog, deprecated and preview included — the
 * SDK's removed `ALL_MODELS`. Empty when no catalog is loaded. Filter with
 * `modelAvailable` / `isVisibleForReleases` exactly as before.
 */
export function allModels(): readonly ModelDefinition[] {
  const ids = installedCatalogIds();
  if (!ids) return [];
  if (_allModelsFor !== ids) {
    _allModels = ids.map((id) => getModel(id)).filter((m): m is ModelDefinition => m !== undefined);
    _allModelsFor = ids;
  }
  return _allModels ?? [];
}

/** The SDK's removed `getModelsByMode`, over the installed catalog. */
export function modelsByMode(mode: GenerationMode, includeHidden = false): ModelDefinition[] {
  return allModels().filter((m) => m.mode === mode && (includeHidden || isVisibleForReleases(m)));
}

/** Test-only: forget the boot. The SDK's installed catalog stays process-global. */
export function resetSdkCatalogForTests(): void {
  _boot = null;
  _bootAt = 0;
  _info = null;
  _allModels = null;
  _allModelsFor = null;
  setInstalledCatalogIds(null);
}

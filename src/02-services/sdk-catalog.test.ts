import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  envCreds: vi.fn(),
  fileCreds: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('#services/auth.ts', () => ({
  getEnvCredentials: mocks.envCreds,
  loadCredentials: mocks.fileCreds,
  refreshAccessToken: mocks.refresh,
}));

const API = 'https://api.example.com';
const CREDS = { token: 't', uid: 'u', refreshToken: 'r', expiresAt: '2999-01-01T00:00:00Z' };

/** A models-catalog body with one model the snapshot has never heard of. */
const BODY = JSON.stringify({
  status: 'success',
  response: {
    total: 1,
    models: [
      {
        id: 'brand-new-model',
        name: 'Brand New Model',
        mode: 'image',
        inputType: 't2i',
        provider: { id: 'acme', name: 'Acme', color: '#000', label: 'A' },
        release: 'production',
        params: {
          prompt: { kind: 'text', required: true, label: 'Prompt' },
          shine: { kind: 'boolean', default: true },
        },
      },
    ],
  },
});

const ok = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'cache-control': 'public, max-age=300', etag: 'W/"v1"', ...headers } });

let home: string;
const originalHome = process.env.HOME;
const originalApi = process.env.GEN_AI_API_URL;

/**
 * Fresh CLI modules per test (boot memo). The SDK itself is an external
 * dependency vitest does not re-evaluate, so its installed catalog persists
 * across tests in this file — every installing test uses the same BODY, and a
 * test that loads nothing asserts on `allModels()`, not the SDK's accessors.
 */
async function load() {
  vi.resetModules();
  const sdkCatalog = await import('./sdk-catalog.ts');
  const cache = await import('./catalog-cache.ts');
  const sdk = await import('@picsart/ai-sdk');
  const errors = await import('#infra/errors/index.ts');
  return { ...sdkCatalog, cache, sdk, errors };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-sdk-catalog-'));
  process.env.HOME = home;
  process.env.GEN_AI_API_URL = API;
  mocks.fetch.mockReset();
  mocks.refresh.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.envCreds.mockReturnValue(null);
  mocks.fileCreds.mockReturnValue(CREDS);
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalApi === undefined) delete process.env.GEN_AI_API_URL;
  else process.env.GEN_AI_API_URL = originalApi;
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('bootSdkCatalog', () => {
  it('loads no catalog when logged out with no cache, and asks for a login', async () => {
    mocks.fileCreds.mockReturnValue(null);
    const m = await load();
    expect(await m.bootSdkCatalog()).toEqual({ source: null, models: 0, reason: 'not logged in', needsLogin: true });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(m.isCatalogLoaded()).toBe(false);
    expect(m.allModels()).toEqual([]);
    expect(() => m.requireCatalog()).toThrow(m.errors.AuthError);
  });

  it('retries a login-blocked boot once credentials exist (a REPL login)', async () => {
    mocks.fileCreds.mockReturnValue(null);
    mocks.fetch.mockResolvedValue(ok(BODY));
    const m = await load();
    await m.bootSdkCatalog();
    await expect(m.ensureCatalog()).rejects.toBeInstanceOf(m.errors.AuthError);

    mocks.fileCreds.mockReturnValue(CREDS);
    await m.ensureCatalog();
    expect(m.allModels().map((x) => x.id)).toEqual(['brand-new-model']);
  });

  it('installs the remote catalog, exposes its models and params, and caches it', async () => {
    mocks.fetch.mockResolvedValue(ok(BODY));
    const m = await load();
    const info = await m.bootSdkCatalog();

    expect(info).toEqual({ source: 'network', models: 1 });
    const [url] = mocks.fetch.mock.calls[0];
    expect(url).toBe(m.catalogUrl(API));
    expect(url).toContain('release=production%2Cgeneral-availability%2Cpreview');
    expect(url).toContain('includeDeprecated=true');

    expect(m.allModels().map((x: { id: string }) => x.id)).toEqual(['brand-new-model']);
    expect(Object.keys(m.sdk.findModel('brand-new-model')?.paramConfig ?? {})).toEqual(['prompt', 'shine']);
    expect(m.modelsByMode('image').map((x: { id: string }) => x.id)).toEqual(['brand-new-model']);
    expect(m.cache.readCatalogCache(m.catalogUrl(API))).toMatchObject({
      body: BODY,
      etag: 'W/"v1"',
      maxAgeMs: 300_000,
    });
  });

  it('installs into the SDK, so any later client reads the loaded catalog', async () => {
    mocks.fetch.mockResolvedValue(ok(BODY));
    const m = await load();
    await m.bootSdkCatalog();
    const { createSdkClient } = await import('./client.ts');
    const client = createSdkClient({ apiUrl: API, fetch: mocks.fetch });
    await expect(client.validate('brand-new-model', { prompt: 'hi' })).resolves.toBeDefined();
  });

  it('serves a fresh cache without a request', async () => {
    const m = await load();
    m.cache.writeCatalogCache({
      url: m.catalogUrl(API),
      body: BODY,
      etag: 'W/"v1"',
      fetchedAt: Date.now(),
      maxAgeMs: 300_000,
    });
    expect(await m.bootSdkCatalog()).toMatchObject({ source: 'cache' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('revalidates an expired cache with its ETag and keeps it on 304', async () => {
    const m = await load();
    const url = m.catalogUrl(API);
    m.cache.writeCatalogCache({ url, body: BODY, etag: 'W/"v1"', fetchedAt: Date.now() - 600_000, maxAgeMs: 300_000 });
    mocks.fetch.mockResolvedValue(new Response(null, { status: 304, headers: { 'cache-control': 'max-age=120' } }));

    expect(await m.bootSdkCatalog()).toMatchObject({ source: 'cache' });
    expect(new Headers(mocks.fetch.mock.calls[0][1]?.headers).get('If-None-Match')).toBe('W/"v1"');
    const refreshed = m.cache.readCatalogCache(url);
    expect(refreshed?.maxAgeMs).toBe(120_000);
    expect(m.cache.isCacheFresh(refreshed!)).toBe(true);
  });

  it('uses a stale cache when the request fails', async () => {
    const m = await load();
    m.cache.writeCatalogCache({
      url: m.catalogUrl(API),
      body: BODY,
      etag: null,
      fetchedAt: Date.now() - 24 * 60 * 60_000,
      maxAgeMs: 300_000,
    });
    mocks.fetch.mockRejectedValue(new TypeError('fetch failed'));
    const info = await m.bootSdkCatalog();
    expect(info).toMatchObject({ source: 'stale-cache' });
    expect(info.reason).toContain('fetch failed');
  });

  it('uses a cache of any age when the request fails — there is no bundled catalog', async () => {
    const m = await load();
    m.cache.writeCatalogCache({
      url: m.catalogUrl(API),
      body: BODY,
      etag: null,
      fetchedAt: Date.now() - 90 * 24 * 60 * 60_000,
      maxAgeMs: 300_000,
    });
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 503 }));
    expect(await m.bootSdkCatalog()).toMatchObject({
      source: 'stale-cache',
      reason: 'catalog request failed (HTTP 503)',
    });
  });

  it('loads nothing from a malformed body, and reports a network-class error', async () => {
    mocks.fetch.mockResolvedValue(ok('{"status":"success","response":{"models":[{"name":"no id"}]}}'));
    const m = await load();
    expect(await m.bootSdkCatalog()).toEqual({
      source: null,
      models: 0,
      reason: 'catalog request failed (malformed catalog response)',
    });
    expect(m.allModels()).toEqual([]);
    expect(() => m.requireCatalog()).toThrow(m.errors.NetworkError);
    expect(m.cache.readCatalogCache(m.catalogUrl(API))).toBeNull();
  });

  const EXPIRED = () => ({ ...CREDS, expiresAt: new Date(Date.now() - 1000).toISOString() });

  it('serves a usable cache without refreshing when the stored token has expired', async () => {
    mocks.fileCreds.mockReturnValue(EXPIRED());
    const m = await load();
    m.cache.writeCatalogCache({
      url: m.catalogUrl(API),
      body: BODY,
      etag: 'W/"v1"',
      fetchedAt: Date.now() - 600_000,
      maxAgeMs: 300_000,
    });
    expect(await m.bootSdkCatalog()).toMatchObject({ source: 'stale-cache', reason: 'access token expired' });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('refreshes an expired token and then loads the catalog when there is no cache', async () => {
    mocks.fileCreds.mockReturnValue(EXPIRED());
    mocks.refresh.mockResolvedValue({ ...CREDS, token: 'fresh' });
    mocks.fetch.mockResolvedValue(ok(BODY));
    const m = await load();

    expect(await m.bootSdkCatalog()).toMatchObject({ source: 'network' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(new Headers(mocks.fetch.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer fresh');
    expect(m.allModels().map((x: { id: string }) => x.id)).toEqual(['brand-new-model']);
  });

  it('loads nothing and asks for a login when the refresh fails and there is no cache', async () => {
    mocks.fileCreds.mockReturnValue(EXPIRED());
    mocks.refresh.mockRejectedValue(new Error('Refresh token revoked'));
    const m = await load();
    expect(await m.bootSdkCatalog()).toMatchObject({
      source: null,
      reason: 'token refresh failed (Refresh token revoked)',
      needsLogin: true,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('reports an unreachable auth server during the refresh as a network failure, not a login', async () => {
    mocks.fileCreds.mockReturnValue(EXPIRED());
    mocks.refresh.mockRejectedValue(
      new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) }),
    );
    const m = await load();
    const info = await m.bootSdkCatalog();
    expect(info).toMatchObject({ source: null, reason: 'token refresh failed (fetch failed)' });
    expect(info.needsLogin).toBeUndefined();
    expect(() => m.requireCatalog()).toThrow(m.errors.NetworkError);
  });

  it('retries a network-failed boot only after the retry interval (a long-lived REPL)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      mocks.fetch.mockRejectedValue(new TypeError('fetch failed'));
      const m = await load();
      await m.bootSdkCatalog();

      // Right after the failure: no second request, the same error.
      await expect(m.ensureCatalog()).rejects.toBeInstanceOf(m.errors.NetworkError);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);

      // Back online 30 s later: the next command loads the catalog.
      vi.advanceTimersByTime(30_000);
      mocks.fetch.mockResolvedValue(ok(BODY));
      await m.ensureCatalog();
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(m.allModels().map((x) => x.id)).toEqual(['brand-new-model']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a catalog 401 as a failed request and never refreshes from it', async () => {
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 401 }));
    const m = await load();
    expect(await m.bootSdkCatalog()).toMatchObject({
      source: null,
      reason: 'catalog request failed (HTTP 401)',
      needsLogin: true,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('aborts a stalled catalog request at the 4 s boot deadline', async () => {
    // AbortSignal.timeout cannot be driven by fake timers; hand boot a signal
    // the test controls, and prove the request only ends when it aborts.
    const deadline = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    try {
      mocks.fetch.mockImplementation(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
            );
          }),
      );
      const m = await load();
      let settled = false;
      const boot = m.bootSdkCatalog().finally(() => {
        settled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
      expect(timeoutSpy).toHaveBeenCalledWith(4000);
      expect(mocks.fetch.mock.calls[0][1]?.signal).toBe(deadline.signal);

      deadline.abort();
      expect(await boot).toMatchObject({
        source: null,
        reason: 'catalog request failed (timed out after 4000 ms)',
      });
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('drops a corrupt cache entry instead of revalidating it with its ETag', async () => {
    const m = await load();
    const url = m.catalogUrl(API);
    m.cache.writeCatalogCache({ url, body: '{"broken":', etag: 'W/"v1"', fetchedAt: Date.now(), maxAgeMs: 300_000 });
    mocks.fetch.mockResolvedValue(ok(BODY));

    expect(await m.bootSdkCatalog()).toMatchObject({ source: 'network' });
    expect(new Headers(mocks.fetch.mock.calls[0][1]?.headers).has('If-None-Match')).toBe(false);
    expect(m.cache.readCatalogCache(url)?.body).toBe(BODY);
  });

  it('installs GEN_AI_CATALOG_FILE without a request, and reports a bad one', async () => {
    const file = path.join(home, 'catalog.json');
    fs.writeFileSync(file, BODY);
    process.env.GEN_AI_CATALOG_FILE = file;
    try {
      let m = await load();
      expect(await m.bootSdkCatalog()).toEqual({ source: 'file', models: 1 });
      expect(m.allModels().map((x: { id: string }) => x.id)).toEqual(['brand-new-model']);

      fs.writeFileSync(file, '{"status":"error"}');
      m = await load();
      expect(await m.bootSdkCatalog()).toMatchObject({
        source: null,
        reason: expect.stringContaining('GEN_AI_CATALOG_FILE'),
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
    } finally {
      delete process.env.GEN_AI_CATALOG_FILE;
    }
  });

  it('boots once for concurrent callers', async () => {
    mocks.fetch.mockResolvedValue(ok(BODY));
    const m = await load();
    const [a, b] = await Promise.all([m.bootSdkCatalog(), m.bootSdkCatalog()]);
    expect(a).toBe(b);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('catalogModelIds', () => {
  it('accepts a models-catalog body and rejects anything else', async () => {
    const m = await load();
    expect(m.catalogModelIds(BODY)).toEqual(['brand-new-model']);
    expect(m.catalogModelIds('not json')).toBeNull();
    expect(m.catalogModelIds('{"status":"error"}')).toBeNull();
    expect(m.catalogModelIds('{"status":"success","response":{"models":[]}}')).toBeNull();
  });
});

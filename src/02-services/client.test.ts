/**
 * Spec for the client service (SDK factory).
 *
 * Contract:
 *   getAuthenticatedFetch():
 *     - Returns { authenticatedFetch, creds } from the current auth state.
 *     - The internal fetch CALLBACK re-reads credentials on each call (so a
 *       freshly refreshed token is picked up without reconstructing the fetch).
 *     - Throws if credentials disappear mid-session.
 *
 *   getAiClient():
 *     - Returns an SDK client with apiUrl from getApiUrl().
 *     - Has every method the CLI expects from `createClient` (smoke).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColorManager } from '#infra/ui-core/color.ts';
import { createOutputManager } from '#infra/ui-core/output.ts';

const getToken = vi.fn();
const loadCredentials = vi.fn();

vi.mock('./auth.ts', () => ({
  getToken: (...args: unknown[]) => getToken(...args),
  loadCredentials: (...args: unknown[]) => loadCredentials(...args),
  refreshAccessToken: vi.fn(),
}));

import { getAiClient, getAuthenticatedFetch, resetAiClientCache } from './client.ts';

createOutputManager({
  color: createColorManager({ enabled: false }),
  quiet: true,
  debug: false,
  jsonMode: false,
  plainMode: false,
});

let originalFetch: typeof fetch;
beforeEach(() => {
  getToken.mockReset();
  loadCredentials.mockReset();
  resetAiClientCache();
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getAuthenticatedFetch                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getAuthenticatedFetch', () => {
  it('returns the current creds + an authenticated fetch fn', async () => {
    const creds = { token: 'tkn', uid: 'usr', expiresAt: Date.now() + 1e6 };
    getToken.mockResolvedValue(creds);
    loadCredentials.mockReturnValue(creds);

    const { authenticatedFetch, creds: returned } = await getAuthenticatedFetch();
    expect(returned).toEqual(creds);
    expect(typeof authenticatedFetch).toBe('function');
  });

  it('the fetch callback re-reads credentials on each call', async () => {
    const oldCreds = { token: 'OLD', uid: 'u', expiresAt: '2099-01-01T00:00:00Z' };
    getToken.mockResolvedValue(oldCreds);
    // First call returns old, second call returns refreshed creds
    let calls = 0;
    loadCredentials.mockImplementation(() => {
      calls++;
      return calls === 1 ? oldCreds : { token: 'NEW', uid: 'u', expiresAt: '2099-01-01T00:00:00Z' };
    });

    const headersByCall: Array<Record<string, string>> = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      headersByCall.push(init?.headers as Record<string, string>);
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const { authenticatedFetch } = await getAuthenticatedFetch();
    await authenticatedFetch('https://api.example.com/a');
    await authenticatedFetch('https://api.example.com/b');

    expect(headersByCall[0].Authorization).toBe('Bearer OLD');
    expect(headersByCall[1].Authorization).toBe('Bearer NEW');
  });

  it('throws when credentials disappear mid-session', async () => {
    getToken.mockResolvedValue({ token: 't', uid: 'u', expiresAt: '2099-01-01T00:00:00Z' });
    loadCredentials.mockReturnValue(null);

    const { authenticatedFetch } = await getAuthenticatedFetch();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    await expect(authenticatedFetch('https://api.example.com/x')).rejects.toThrow(/gen-ai login/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getAiClient                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getAiClient', () => {
  it('returns an SDK client with the expected high-level methods', async () => {
    const creds = { token: 't', uid: 'u', expiresAt: '2099-01-01T00:00:00Z' };
    getToken.mockResolvedValue(creds);
    loadCredentials.mockReturnValue(creds);

    const client = await getAiClient();
    // Public API surface of the SDK client (smoke — actual SDK creates these).
    expect(typeof client.generate).toBe('function');
    expect(typeof client.estimate).toBe('function');
  });

  it('caches the client — repeated calls return the same instance without re-auth', async () => {
    const creds = { token: 't', uid: 'u', expiresAt: '2099-01-01T00:00:00Z' };
    getToken.mockResolvedValue(creds);
    loadCredentials.mockReturnValue(creds);

    const a = await getAiClient();
    const b = await getAiClient();
    expect(b).toBe(a);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed build — the next call retries', async () => {
    getToken.mockRejectedValueOnce(new Error('offline'));
    await expect(getAiClient()).rejects.toThrow('offline');

    const creds = { token: 't', uid: 'u', expiresAt: '2099-01-01T00:00:00Z' };
    getToken.mockResolvedValue(creds);
    loadCredentials.mockReturnValue(creds);
    const client = await getAiClient();
    expect(typeof client.generate).toBe('function');
  });
});

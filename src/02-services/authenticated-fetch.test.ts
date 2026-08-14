/**
 * Spec for the authenticated-fetch service.
 *
 * Contract:
 *   - Adds Authorization + user-id headers from getCreds().
 *   - Forwards user-supplied headers (init.headers) alongside auth headers.
 *   - On 401, calls refreshAccessToken() and retries ONCE.
 *   - If the refresh call throws, surfaces a "run gen-ai login" hint.
 *   - Successful (non-401) responses are returned without retry.
 *   - Uses init.signal when provided; otherwise applies a default timeout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColorManager } from '#infra/ui-core/color.ts';
import { createOutputManager } from '#infra/ui-core/output.ts';

const refreshAccessToken = vi.fn();

vi.mock('#services/auth.ts', () => ({
  refreshAccessToken: (...args: unknown[]) => refreshAccessToken(...args),
}));

import { createAuthenticatedFetch } from './authenticated-fetch.ts';

// ⚠ DESIGN NOTE: createAuthenticatedFetch reaches for the global
// `getOutput()` singleton on the 401 retry path. That violates the
// project's "no singletons" rule. Test-setup workaround: prime the
// singleton so tests can run. Real fix: pass an `onMessage` callback
// through opts, or move logging up to the caller.
createOutputManager({
  color: createColorManager({ enabled: false }),
  quiet: true,
  debug: false,
  jsonMode: false,
  plainMode: false,
});

let originalFetch: typeof fetch;

beforeEach(() => {
  refreshAccessToken.mockReset();
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Auth headers                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('createAuthenticatedFetch — auth headers', () => {
  it('adds Authorization Bearer + user-id from getCreds()', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const auth = createAuthenticatedFetch(() => ({
      token: 'tkn',
      uid: 'usr',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    await auth('https://api.example.com/path', {});

    expect(capturedHeaders.Authorization).toBe('Bearer tkn');
    expect(capturedHeaders['user-id']).toBe('usr');
  });

  it('preserves caller-supplied headers alongside auth headers', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const auth = createAuthenticatedFetch(() => ({
      token: 't',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    await auth('https://api.example.com/path', { headers: { 'X-Custom': 'value' } });
    expect(capturedHeaders['X-Custom']).toBe('value');
    expect(capturedHeaders.Authorization).toBe('Bearer t');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Non-401 passthrough                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

describe('createAuthenticatedFetch — non-401 responses', () => {
  it('returns the response directly without calling refresh', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const auth = createAuthenticatedFetch(() => ({
      token: 't',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    const res = await auth('https://api.example.com/x');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('passes through non-401 error status codes', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const auth = createAuthenticatedFetch(() => ({
      token: 't',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    expect((await auth('https://api.example.com/x')).status).toBe(500);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  401 retry                                                             */
/* ─────────────────────────────────────────────────────────────────────── */

describe('createAuthenticatedFetch — 401 retry', () => {
  it('on 401, calls refresh and retries with the refreshed token', async () => {
    let callCount = 0;
    const headersByCall: Array<Record<string, string>> = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      callCount++;
      headersByCall.push(init?.headers as Record<string, string>);
      return new Response('', { status: callCount === 1 ? 401 : 200 });
    }) as unknown as typeof fetch;

    refreshAccessToken.mockResolvedValue({
      token: 'NEW',
      uid: 'usr-refreshed',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    });

    const auth = createAuthenticatedFetch(() => ({
      token: 'OLD',
      uid: 'usr',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    const res = await auth('https://api.example.com/x');

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(headersByCall[0].Authorization).toBe('Bearer OLD');
    expect(headersByCall[1].Authorization).toBe('Bearer NEW');
  });

  it('does not retry more than once', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response('', { status: 401 });
    }) as unknown as typeof fetch;
    refreshAccessToken.mockResolvedValue({
      token: 'NEW',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    });

    const auth = createAuthenticatedFetch(() => ({
      token: 'OLD',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    const res = await auth('https://api.example.com/x');

    expect(res.status).toBe(401);
    expect(callCount).toBe(2); // initial + 1 retry only
  });

  it('throws a "gen-ai login" hint when refresh fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    refreshAccessToken.mockRejectedValue(new Error('refresh failed'));

    const auth = createAuthenticatedFetch(() => ({
      token: 'OLD',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    await expect(auth('https://api.example.com/x')).rejects.toThrow(/gen-ai login/i);
  });

  it('cancels the discarded 401 response body before retrying', async () => {
    // An unconsumed body pins the socket (undici keeps the connection out of
    // the pool until GC) — the retry path must release it explicitly.
    let cancelled = false;
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        const body = new ReadableStream({
          cancel() {
            cancelled = true;
          },
        });
        return new Response(body, { status: 401 });
      }
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    refreshAccessToken.mockResolvedValue({
      token: 'NEW',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    });

    const auth = createAuthenticatedFetch(() => ({
      token: 'OLD',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    const res = await auth('https://api.example.com/x');

    expect(res.status).toBe(200);
    expect(cancelled).toBe(true);
  });

  it('refreshed token wins over a caller-supplied Authorization header on the retry', async () => {
    // Caller headers normally override auth headers, but on the retry that
    // would re-send the very token that just earned the 401.
    const headersByCall: Array<Record<string, string>> = [];
    let callCount = 0;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      callCount++;
      headersByCall.push(init?.headers as Record<string, string>);
      return new Response('', { status: callCount === 1 ? 401 : 200 });
    }) as unknown as typeof fetch;
    refreshAccessToken.mockResolvedValue({
      token: 'NEW',
      uid: 'uid-new',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    });

    const auth = createAuthenticatedFetch(() => ({
      token: 'OLD',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    const res = await auth('https://api.example.com/x', {
      headers: { Authorization: 'Bearer STALE', 'X-Custom': 'kept' },
    });

    expect(res.status).toBe(200);
    // First attempt: caller override applies (documented behavior).
    expect(headersByCall[0].Authorization).toBe('Bearer STALE');
    // Retry: refreshed identity must win; other caller headers survive.
    expect(headersByCall[1].Authorization).toBe('Bearer NEW');
    expect(headersByCall[1]['user-id']).toBe('uid-new');
    expect(headersByCall[1]['X-Custom']).toBe('kept');
  });

  it('does NOT retry a 401 when the body is a one-shot ReadableStream', async () => {
    // A consumed stream cannot be replayed — the retry would throw. The 401
    // must be handed back to the caller instead.
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response('', { status: 401 });
    }) as unknown as typeof fetch;
    refreshAccessToken.mockResolvedValue({
      token: 'NEW',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    });

    const auth = createAuthenticatedFetch(() => ({
      token: 'OLD',
      uid: 'u',
      refreshToken: 'r',
      email: 'a@b',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('payload'));
        controller.close();
      },
    });
    const res = await auth('https://api.example.com/x', { method: 'POST', body });

    expect(res.status).toBe(401);
    expect(callCount).toBe(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});

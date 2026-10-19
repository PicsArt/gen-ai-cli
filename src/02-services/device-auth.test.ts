/**
 * Spec for the device-authorization-grant service (RFC 8628).
 *
 * Contract:
 *   requestDeviceCode(): POSTs client_id+scope form-encoded, returns the code pair.
 *   pollForToken(): loops the token endpoint, honoring interval/slow_down/pending,
 *     stopping on approval, denial, expiry, and mapping transport failures to NetworkError.
 *   refreshDeviceToken(): renews a device credential at the auth server token endpoint.
 *   deviceLogin(): orchestrates request -> print -> poll -> user info -> save.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '#infra/errors/auth.ts';
import { NetworkError } from '#infra/errors/network.ts';
import { deviceLogin, pollForToken, refreshDeviceToken, requestDeviceCode } from './device-auth.ts';

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.GEN_AI_DEVICE_AUTH_URL = 'https://auth-test.example.com/api';
  process.env.GEN_AI_DEVICE_CLIENT_ID = 'test-cli';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEN_AI_DEVICE_AUTH_URL;
  delete process.env.GEN_AI_DEVICE_CLIENT_ID;
});

describe('requestDeviceCode', () => {
  it('POSTs client_id+scope form-encoded and returns the code pair', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body);
      return new Response(
        JSON.stringify({
          device_code: 'dc:abc',
          user_code: 'WXYZ-1234',
          verification_uri: 'https://accounts.example.com/device',
          verification_uri_complete: 'https://accounts.example.com/device?user_code=WXYZ-1234',
          interval: 5,
          expires_in: 300,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const res = await requestDeviceCode();
    expect(capturedUrl).toBe('https://auth-test.example.com/api/oauth2/device_authorization');
    expect(capturedBody).toContain('client_id=test-cli');
    expect(capturedBody).toContain('scope=user-global');
    expect(res.user_code).toBe('WXYZ-1234');
    expect(res.interval).toBe(5);
  });

  it('throws AuthError on invalid_client', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(requestDeviceCode()).rejects.toBeInstanceOf(AuthError);
  });
});

const noSleep = () => Promise.resolve();
const far = () => Date.now() + 60_000;

function queue(responses: Array<() => Response>) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]()) as unknown as typeof fetch;
}
const pending = () => new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 });
const ok = () =>
  new Response(
    JSON.stringify({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      refresh_token_expires_in: 86400,
      token_type: 'Bearer',
    }),
    { status: 200 },
  );

describe('pollForToken', () => {
  it('returns tokens after pending responses', async () => {
    queue([pending, pending, ok]);
    const t = await pollForToken('dc:x', 0, far(), { sleep: noSleep });
    expect(t.access_token).toBe('at');
  });

  it('raises the interval permanently on slow_down', async () => {
    const delays: number[] = [];
    const sleep = (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    };
    queue([() => new Response(JSON.stringify({ error: 'slow_down' }), { status: 400 }), pending, ok]);
    await pollForToken('dc:x', 5, far(), { sleep });
    // first wait uses the server interval (5s); after slow_down it is +5s and STAYS there.
    expect(delays).toEqual([5_000, 10_000, 10_000]);
  });

  it('throws AuthError on access_denied', async () => {
    queue([() => new Response(JSON.stringify({ error: 'access_denied' }), { status: 400 })]);
    await expect(pollForToken('dc:x', 0, far(), { sleep: noSleep })).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError (expired) once past expiresAt', async () => {
    queue([pending]);
    await expect(pollForToken('dc:x', 0, Date.now() - 1, { sleep: noSleep })).rejects.toThrow(/expired/i);
  });

  it('maps a transport failure to NetworkError', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(pollForToken('dc:x', 0, far(), { sleep: noSleep })).rejects.toBeInstanceOf(NetworkError);
  });

  it('throws on a non-JSON body instead of a SyntaxError', async () => {
    queue([() => new Response('<html>502</html>', { status: 502 })]);
    await expect(pollForToken('dc:x', 0, far(), { sleep: noSleep })).rejects.toBeInstanceOf(AuthError);
  });
});

describe('refreshDeviceToken', () => {
  it('POSTs refresh_token grant to the device token endpoint and keeps authSource', async () => {
    let body = '';
    let url = '';
    globalThis.fetch = vi.fn(async (u: unknown, init?: RequestInit) => {
      url = String(u);
      body = String(init?.body);
      return new Response(
        JSON.stringify({
          access_token: 'new-at',
          refresh_token: 'new-rt',
          expires_in: 3600,
          refresh_token_expires_in: 86400,
          token_type: 'Bearer',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const updated = await refreshDeviceToken({
      token: 'old',
      refreshToken: 'old-rt',
      uid: 'u',
      email: 'e@x',
      expiresAt: '2000-01-01T00:00:00Z',
      authSource: 'device',
    });
    expect(url).toBe('https://auth-test.example.com/api/oauth2/token');
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=old-rt');
    expect(body).toContain('client_id=test-cli');
    expect(updated.token).toBe('new-at');
    expect(updated.refreshToken).toBe('new-rt');
    expect(updated.authSource).toBe('device');
  });

  it('throws AuthError when the server rejects the refresh', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(
      refreshDeviceToken({
        token: 't',
        refreshToken: 'r',
        uid: 'u',
        email: 'e',
        expiresAt: '2000-01-01T00:00:00Z',
        authSource: 'device',
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('deviceLogin', () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-devlogin-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome; // redirect saveCredentials away from the real ~/.gen-ai
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('prints the user code, polls, fetches user info, and returns device-tagged creds', async () => {
    const infos: string[] = [];
    const out = { info: (m: string) => infos.push(m) };
    const seq = [
      () =>
        new Response(
          JSON.stringify({
            device_code: 'dc:1',
            user_code: 'CODE-9',
            verification_uri: 'https://accounts.example.com/device',
            verification_uri_complete: 'https://accounts.example.com/device?user_code=CODE-9',
            interval: 0,
            expires_in: 300,
          }),
          { status: 200 },
        ),
      () =>
        new Response(
          JSON.stringify({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            refresh_token_expires_in: 86400,
            token_type: 'Bearer',
          }),
          { status: 200 },
        ),
      () => new Response(JSON.stringify({ status: 'success', id: 42, email: 'me@x.com' }), { status: 200 }),
    ];
    let i = 0;
    globalThis.fetch = vi.fn(async () => seq[Math.min(i++, seq.length - 1)]()) as unknown as typeof fetch;

    const creds = await deviceLogin(out, { sleep: noSleep });
    expect(infos.join('\n')).toContain('CODE-9');
    expect(infos.join('\n')).toContain('accounts.example.com/device');
    expect(creds).toMatchObject({
      token: 'at',
      refreshToken: 'rt',
      uid: '42',
      email: 'me@x.com',
      authSource: 'device',
    });
  });
});

describe('device-auth robustness (Codex findings)', () => {
  it('requestDeviceCode throws AuthError when required fields are missing', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ device_code: 'dc:only' }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(requestDeviceCode()).rejects.toBeInstanceOf(AuthError);
  });

  it('pollForToken aborts the wait and reports cancellation, not a network error', async () => {
    const controller = new AbortController();
    let fetchCalled = false;
    globalThis.fetch = vi.fn(async () => {
      fetchCalled = true;
      return ok();
    }) as unknown as typeof fetch;
    // Abort DURING the wait (the sleep), before any fetch.
    const sleep = () => {
      controller.abort();
      return Promise.resolve();
    };
    await expect(pollForToken('dc:x', 1, far(), { signal: controller.signal, sleep })).rejects.toThrow(/cancel/i);
    expect(fetchCalled).toBe(false);
  });

  it('pollForToken keeps a request timeout even when a caller signal is supplied', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return ok();
    }) as unknown as typeof fetch;
    await pollForToken('dc:x', 0, far(), { signal: controller.signal, sleep: noSleep });
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    // Must be a COMBINED signal (caller + timeout), not the raw caller signal that
    // would otherwise replace the 30s request timeout.
    expect(seenSignal).not.toBe(controller.signal);
  });
});

describe('pollForToken response validation (Codex finding)', () => {
  it('rejects a 200 token response missing refresh_token/expires_in', async () => {
    queue([() => new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })]);
    await expect(pollForToken('dc:x', 0, far(), { sleep: noSleep })).rejects.toBeInstanceOf(AuthError);
  });
});

describe('requestDeviceCode interval default (RFC 8628 §3.2)', () => {
  it('accepts a response without interval and defaults it to 5s', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            device_code: 'dc:x',
            user_code: 'AAAA-BBBB',
            verification_uri: 'https://accounts.example.com/device',
            expires_in: 300,
            // no interval — RFC 8628 says default to 5
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const res = await requestDeviceCode();
    expect(res.interval).toBe(5);
    expect(res.user_code).toBe('AAAA-BBBB');
  });
});

describe('refreshDeviceToken response validation (Codex finding)', () => {
  it('rejects a 200 refresh response missing refresh_token/expires_in', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ access_token: 'only-at' }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      refreshDeviceToken({
        token: 't',
        refreshToken: 'r',
        uid: 'u',
        email: 'e',
        expiresAt: '2000-01-01T00:00:00Z',
        authSource: 'device',
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('requestDeviceCode interval clamping (Codex finding)', () => {
  it('defaults a zero/negative/non-finite interval to 5s', async () => {
    for (const bad of [0, -3, Number.NaN]) {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              device_code: 'dc:x',
              user_code: 'AAAA-BBBB',
              verification_uri: 'https://accounts.example.com/device',
              expires_in: 300,
              interval: bad,
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;
      const res = await requestDeviceCode();
      expect(res.interval).toBe(5);
    }
  });
});

describe('requestDeviceCode expiry sanity (Codex finding)', () => {
  it('clamps an absurd expires_in and rejects a non-positive one', async () => {
    const mk = (expires_in: number) =>
      new Response(
        JSON.stringify({
          device_code: 'dc:x',
          user_code: 'AAAA-BBBB',
          verification_uri: 'https://accounts.example.com/device',
          interval: 5,
          expires_in,
        }),
        { status: 200 },
      );
    globalThis.fetch = vi.fn(async () => mk(1e40)) as unknown as typeof fetch;
    const res = await requestDeviceCode();
    expect(res.expires_in).toBeLessThanOrEqual(86_400);
    expect(Number.isFinite(Date.now() + res.expires_in * 1000)).toBe(true);

    globalThis.fetch = vi.fn(async () => mk(0)) as unknown as typeof fetch;
    const res2 = await requestDeviceCode();
    expect(res2.expires_in).toBeGreaterThan(0);
  });
});

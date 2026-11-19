/**
 * Spec for the Authorization Code + PKCE primitives.
 *
 *   createPkcePair(): an RFC 7636 verifier and its S256 challenge.
 *   exchangeAuthorizationCode(): redeems the code at the auth server token
 *     endpoint as a public client, and rejects unusable responses.
 */
import * as crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '#infra/errors/index.ts';
import { createPkcePair, exchangeAuthorizationCode } from './auth-code.ts';

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

function mockTokenEndpoint(body: unknown, status = 200): void {
  globalThis.fetch = vi.fn(
    async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe('createPkcePair', () => {
  it('returns an RFC 7636 verifier and its S256 challenge', () => {
    const { verifier, challenge } = createPkcePair();
    // §4.1: 43-128 chars from the unreserved set.
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
  });

  it('generates a fresh verifier per login', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});

describe('exchangeAuthorizationCode', () => {
  it('POSTs the authorization_code grant with the PKCE verifier, form-encoded, with a timeout', async () => {
    let url = '';
    let init: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (u: unknown, i?: RequestInit) => {
      url = String(u);
      init = i;
      return new Response(
        JSON.stringify({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
          refresh_token_expires_in: 86_400,
          token_type: 'Bearer',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const tokens = await exchangeAuthorizationCode('the-code', 'http://localhost:5161', 'the-verifier');

    expect(url).toBe('https://auth-test.example.com/api/oauth2/token');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://localhost:5161',
      client_id: 'test-cli',
      code_verifier: 'the-verifier',
    });
    expect(tokens).toEqual({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      refresh_token_expires_in: 86_400,
    });
  });

  it('surfaces the server error_description as an AuthError', async () => {
    mockTokenEndpoint({ error: 'invalid_grant', error_description: 'code expired' }, 400);
    const failure = exchangeAuthorizationCode('c', 'http://localhost:5161', 'v');
    await expect(failure).rejects.toBeInstanceOf(AuthError);
    await expect(failure).rejects.toThrow('Token exchange failed: code expired');
  });

  it('falls back to the error code, then the HTTP status', async () => {
    mockTokenEndpoint({ error: 'invalid_client' }, 401);
    await expect(exchangeAuthorizationCode('c', 'r', 'v')).rejects.toThrow('Token exchange failed: invalid_client');

    // A proxy's HTML error page must not surface as a SyntaxError.
    mockTokenEndpoint('<html>Bad Gateway</html>', 502);
    await expect(exchangeAuthorizationCode('c', 'r', 'v')).rejects.toThrow('Token exchange failed: HTTP 502');
  });

  it('rejects a 200 with no refresh token — the session could never be renewed', async () => {
    mockTokenEndpoint({ access_token: 'at', expires_in: 3600 });
    await expect(exchangeAuthorizationCode('c', 'r', 'v')).rejects.toThrow(/incomplete token response/);
  });

  it('rejects a 200 with a non-numeric expires_in — the saved expiry would be NaN', async () => {
    mockTokenEndpoint({ access_token: 'at', refresh_token: 'rt', expires_in: '3600' });
    await expect(exchangeAuthorizationCode('c', 'r', 'v')).rejects.toThrow(/incomplete token response/);
  });

  it('drops a non-numeric refresh_token_expires_in instead of storing it', async () => {
    mockTokenEndpoint({ access_token: 'at', refresh_token: 'rt', expires_in: 60, refresh_token_expires_in: 'soon' });
    const tokens = await exchangeAuthorizationCode('c', 'r', 'v');
    expect(tokens.refresh_token_expires_in).toBeUndefined();
  });
});

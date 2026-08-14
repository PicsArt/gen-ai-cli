/**
 * OAuth login flow — integration-style: login() starts a real loopback HTTP
 * server; the test plays the browser by hitting the callback URL. The token
 * exchange and user-info endpoints are mocked at the fetch layer.
 *
 * Covers the callback regressions: stray paths (favicon) must get a 404
 * instead of a hanging socket, a state mismatch must NOT consume the flow,
 * and the success page must be flushed before the server closes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColorManager } from '#infra/ui-core/color.ts';
import { createOutputManager } from '#infra/ui-core/output.ts';

const openInDefaultMock = vi.hoisted(() => vi.fn());

vi.mock('#infra/utils/open.ts', () => ({
  openInDefault: openInDefaultMock,
}));

import { login } from './auth.ts';

// login() logs through the OutputManager singleton — prime it quietly.
createOutputManager({
  color: createColorManager({ enabled: false }),
  quiet: true,
  debug: false,
  jsonMode: false,
  plainMode: false,
});

const realFetch = globalThis.fetch;

let tmpHome: string;
let originalHome: string | undefined;
let tokenFetchInits: Array<{ url: string; init?: RequestInit }>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-login-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  openInDefaultMock.mockReset();
  tokenFetchInits = [];

  // Token exchange + user info are remote calls — mock them; everything else
  // (the loopback callback below) goes through the real fetch.
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    const u = String(url);
    tokenFetchInits.push({ url: u, init });
    if (u.includes('/oauth2/code/exchange')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'success',
            response: {
              access_token: 'at-123',
              refresh_token: 'rt-456',
              expires_in: 3600,
              refresh_token_expires_in: 86_400,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (u.includes('/users/show/me.json')) {
      return Promise.resolve(
        new Response(JSON.stringify({ response: { id: 42, email: 'user@picsart.com' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return realFetch(url as string, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

/** Start login(), wait for the auth URL, return its redirect_uri + state. */
async function startLogin(): Promise<{
  promise: ReturnType<typeof login>;
  redirectUri: string;
  state: string;
}> {
  const promise = login();
  await vi.waitFor(() => {
    expect(openInDefaultMock).toHaveBeenCalled();
  });
  const authUrl = new URL(openInDefaultMock.mock.calls[0][0] as string);
  const redirectUri = authUrl.searchParams.get('redirect_uri') as string;
  const state = authUrl.searchParams.get('state') as string;
  return { promise, redirectUri, state };
}

describe('login — OAuth callback server', () => {
  it('completes the flow: callback → token exchange → credentials saved', async () => {
    const { promise, redirectUri, state } = await startLogin();

    const res = await realFetch(`${redirectUri}/?code=auth-code&state=${state}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Login Successful');

    const creds = await promise;
    expect(creds.token).toBe('at-123');
    expect(creds.refreshToken).toBe('rt-456');
    expect(creds.uid).toBe('42');
    expect(creds.email).toBe('user@picsart.com');

    const saved = JSON.parse(fs.readFileSync(path.join(tmpHome, '.gen-ai', 'credentials.json'), 'utf-8'));
    expect(saved.token).toBe('at-123');
  });

  it('answers stray paths (favicon) with 404 instead of hanging, and keeps the flow alive', async () => {
    const { promise, redirectUri, state } = await startLogin();

    const favicon = await realFetch(`${redirectUri}/favicon.ico`);
    expect(favicon.status).toBe(404);

    const res = await realFetch(`${redirectUri}/?code=auth-code&state=${state}`);
    expect(res.status).toBe(200);
    await expect(promise).resolves.toMatchObject({ token: 'at-123' });
  });

  it('rejects a state mismatch with 400 but lets the genuine callback follow', async () => {
    const { promise, redirectUri, state } = await startLogin();

    const bad = await realFetch(`${redirectUri}/?code=evil&state=wrong-state`);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('State mismatch');

    const good = await realFetch(`${redirectUri}/?code=auth-code&state=${state}`);
    expect(good.status).toBe(200);
    await expect(promise).resolves.toMatchObject({ token: 'at-123' });
  });

  it('rejects the login when the provider reports an OAuth error', async () => {
    const { promise, redirectUri } = await startLogin();

    // Attach the rejection handler BEFORE triggering the callback — the
    // promise settles while the HTTP response is still in flight.
    const rejection = expect(promise).rejects.toThrow(/access_denied/);
    const res = await realFetch(`${redirectUri}/?error=access_denied&error_description=nope`);
    expect(res.status).toBe(400);
    await rejection;
  });

  it('passes an abort signal to token-exchange and user-info fetches', async () => {
    // Regression: these run after `handled = true` disarms the 5-minute login
    // timer — without their own timeout signal a stalled endpoint would leave
    // login() pending forever.
    const { promise, redirectUri, state } = await startLogin();
    await realFetch(`${redirectUri}/?code=auth-code&state=${state}`);
    await promise;

    const exchange = tokenFetchInits.find((c) => c.url.includes('/oauth2/code/exchange'));
    const userInfo = tokenFetchInits.find((c) => c.url.includes('/users/show/me.json'));
    expect(exchange?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(userInfo?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('writes credentials atomically — no .tmp file left behind', async () => {
    const { promise, redirectUri, state } = await startLogin();
    await realFetch(`${redirectUri}/?code=auth-code&state=${state}`);
    await promise;

    const credDir = path.join(tmpHome, '.gen-ai');
    expect(fs.existsSync(path.join(credDir, 'credentials.json'))).toBe(true);
    expect(fs.existsSync(path.join(credDir, 'credentials.json.tmp'))).toBe(false);
  });

  it('rejects when the callback carries no code', async () => {
    const { promise, redirectUri, state } = await startLogin();

    const rejection = expect(promise).rejects.toThrow(/no authorization code/i);
    const res = await realFetch(`${redirectUri}/?state=${state}`);
    expect(res.status).toBe(400);
    await rejection;
  });

  it('flushes the full error page before closing the server (provider error)', async () => {
    // Regression: closeAllConnections() right after res.end() can destroy the
    // socket before the browser receives the page — the error paths must wait
    // for the response to finish, like the success path does.
    const { promise, redirectUri } = await startLogin();

    const rejection = expect(promise).rejects.toThrow(/access_denied/);
    const res = await realFetch(`${redirectUri}/?error=access_denied`);
    const body = await res.text();
    expect(body).toContain('Login Failed');
    expect(body).toContain('</html>');
    await rejection;
  });

  it('rejects with the descriptive exchange error when a 200 lacks a `response` payload', async () => {
    // Regression: a 200 { status: 'success' } with no `response` used to hit
    // the destructuring line and reject with a bare TypeError instead of the
    // intended "Token exchange failed…" error.
    globalThis.fetch = ((url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/oauth2/code/exchange')) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'success' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return realFetch(url as string, init);
    }) as typeof fetch;

    const { promise, redirectUri, state } = await startLogin();
    const rejection = expect(promise).rejects.toThrow(/Token exchange failed/);
    const res = await realFetch(`${redirectUri}/?code=auth-code&state=${state}`);
    expect(res.status).toBe(400);
    await rejection;
  });

  it('flushes the full error page before closing the server (missing code)', async () => {
    const { promise, redirectUri, state } = await startLogin();

    const rejection = expect(promise).rejects.toThrow(/no authorization code/i);
    const res = await realFetch(`${redirectUri}/?state=${state}`);
    const body = await res.text();
    expect(body).toContain('No authorization code received.');
    expect(body).toContain('</html>');
    await rejection;
  });
});

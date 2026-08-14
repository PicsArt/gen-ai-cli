/**
 * Spec for the auth service.
 *
 * Contract:
 *   loadCredentials():
 *     - returns null when no credentials file exists
 *     - returns null when the file is malformed JSON
 *     - returns null when required fields are missing
 *     - returns parsed credentials when valid
 *
 *   logout():
 *     - removes the credentials file (idempotent — no throw when missing)
 *
 *   whoami():
 *     - returns the current credentials, or null
 *
 *   getToken():
 *     - prefers PICSART_ACCESS_TOKEN + PICSART_USER_ID env vars when both set
 *     - returns cached token when not yet expired
 *     - throws AuthError when no creds and stdin is not a TTY (CI/non-interactive)
 *     - throws NetworkError (not AuthError) when the token refresh fails at the
 *       transport layer — an offline/sandboxed shell is not a credential problem
 *     - still throws AuthError when the auth server itself rejects the refresh
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthError, ExitCode, NetworkError } from '#infra/errors/index.ts';
import {
  type Credentials,
  getEnvCredentials,
  getToken,
  loadCredentials,
  logout,
  refreshAccessToken,
  whoami,
} from './auth.ts';

let tmpHome: string;
let originalHome: string | undefined;
let originalEnvToken: string | undefined;
let originalEnvUid: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-auth-'));
  originalHome = process.env.HOME;
  originalEnvToken = process.env.PICSART_ACCESS_TOKEN;
  originalEnvUid = process.env.PICSART_USER_ID;
  process.env.HOME = tmpHome;
  delete process.env.PICSART_ACCESS_TOKEN;
  delete process.env.PICSART_USER_ID;
});
afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalEnvToken !== undefined) process.env.PICSART_ACCESS_TOKEN = originalEnvToken;
  else delete process.env.PICSART_ACCESS_TOKEN;
  if (originalEnvUid !== undefined) process.env.PICSART_USER_ID = originalEnvUid;
  else delete process.env.PICSART_USER_ID;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const credPath = () => path.join(tmpHome, '.gen-ai', 'credentials.json');
function writeCreds(c: Record<string, unknown> | Credentials): void {
  fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
  fs.writeFileSync(credPath(), JSON.stringify(c));
}
function validCreds(over: Partial<Credentials> = {}): Credentials {
  return {
    token: 'tok',
    refreshToken: 'rfr',
    uid: 'usr',
    email: 'a@b.c',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  loadCredentials                                                       */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCredentials', () => {
  it('returns null when no file exists', () => {
    expect(loadCredentials()).toBeNull();
  });

  it('returns null when JSON is malformed', () => {
    fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
    fs.writeFileSync(credPath(), 'not json');
    expect(loadCredentials()).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    writeCreds({ token: 'x' }); // missing uid, refreshToken, etc.
    expect(loadCredentials()).toBeNull();
  });

  it('returns parsed credentials when all required fields are present', () => {
    writeCreds(validCreds());
    const c = loadCredentials();
    expect(c).not.toBeNull();
    expect(c?.token).toBe('tok');
    expect(c?.uid).toBe('usr');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  logout                                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('logout', () => {
  it('removes the credentials file', async () => {
    writeCreds(validCreds());
    expect(fs.existsSync(credPath())).toBe(true);
    await logout();
    expect(fs.existsSync(credPath())).toBe(false);
  });

  it('is idempotent — does not throw when no file exists', async () => {
    await expect(logout()).resolves.not.toThrow();
  });

  it('reports env credentials still active after removing the file (CI/env auth)', async () => {
    process.env.PICSART_ACCESS_TOKEN = 'env-tkn';
    process.env.PICSART_USER_ID = 'env-uid';
    writeCreds(validCreds());
    const result = await logout();
    expect(fs.existsSync(credPath())).toBe(false); // file still removed
    expect(result.envCredentialsActive).toBe(true);
  });

  it('reports no active env credentials on a plain logout', async () => {
    writeCreds(validCreds());
    const result = await logout();
    expect(result.envCredentialsActive).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  whoami                                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('whoami', () => {
  it('returns null when no credentials exist', async () => {
    expect(await whoami()).toBeNull();
  });

  it('returns the credentials when present', async () => {
    writeCreds(validCreds({ email: 'me@example.com' }));
    const c = await whoami();
    expect(c?.email).toBe('me@example.com');
  });

  it('returns env credentials when set and no credentials file exists (CI/env auth)', async () => {
    process.env.PICSART_ACCESS_TOKEN = 'env-tkn';
    process.env.PICSART_USER_ID = 'env-uid';
    const c = await whoami();
    expect(c?.token).toBe('env-tkn');
    expect(c?.uid).toBe('env-uid');
  });

  it('prefers env credentials over the file — same precedence as getToken', async () => {
    process.env.PICSART_ACCESS_TOKEN = 'env-tkn';
    process.env.PICSART_USER_ID = 'env-uid';
    writeCreds(validCreds({ uid: 'file-uid' }));
    const c = await whoami();
    expect(c?.uid).toBe('env-uid');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getToken                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getEnvCredentials', () => {
  it('returns credentials when both env vars are set', () => {
    process.env.PICSART_ACCESS_TOKEN = 'env-tkn';
    process.env.PICSART_USER_ID = 'env-uid';
    const creds = getEnvCredentials();
    expect(creds?.token).toBe('env-tkn');
    expect(creds?.uid).toBe('env-uid');
    // No refresh token — an env token can only be replaced, never rotated.
    expect(creds?.refreshToken).toBe('');
  });

  it('returns null when either env var is missing', () => {
    process.env.PICSART_ACCESS_TOKEN = 'env-tkn';
    expect(getEnvCredentials()).toBeNull();
    delete process.env.PICSART_ACCESS_TOKEN;
    process.env.PICSART_USER_ID = 'env-uid';
    expect(getEnvCredentials()).toBeNull();
  });

  it('returns null when neither is set', () => {
    expect(getEnvCredentials()).toBeNull();
  });
});

describe('getToken', () => {
  it('prefers env vars when both PICSART_ACCESS_TOKEN and PICSART_USER_ID are set', async () => {
    process.env.PICSART_ACCESS_TOKEN = 'env-tok';
    process.env.PICSART_USER_ID = 'env-uid';
    writeCreds(validCreds({ token: 'file-tok', uid: 'file-uid' }));
    expect(await getToken()).toEqual({ token: 'env-tok', uid: 'env-uid' });
  });

  it('returns the cached token when not expired', async () => {
    writeCreds(validCreds());
    expect(await getToken()).toEqual({ token: 'tok', uid: 'usr' });
  });

  it('throws AuthError in non-TTY mode when no credentials exist', async () => {
    // Simulate non-TTY by forcing isTTY to false.
    const orig = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      await expect(getToken()).rejects.toThrow(/Not authenticated|gen-ai login|PICSART_ACCESS_TOKEN/);
    } finally {
      if (orig) Object.defineProperty(process.stdin, 'isTTY', orig);
    }
  });

  /* Refresh-failure classification: a transport failure and a rejection from
     the auth server are different diagnoses and must not collapse into one.
     Regression guard — these used to share a bare `catch {}` that discarded the
     real error and reported "Not authenticated" for an offline shell. */

  it('surfaces NetworkError (exit 4) when the token refresh fails at the transport layer', async () => {
    writeCreds(validCreds({ expiresAt: new Date(Date.now() - 3600_000).toISOString() }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }) as unknown as typeof fetch;
    try {
      const err = await getToken().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NetworkError);
      expect((err as NetworkError).exitCode).toBe(ExitCode.NETWORK_ERROR);
      expect((err as NetworkError).friendlyMessage).not.toMatch(/Not authenticated/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not let a non-JSON error page (proxy 502) surface as a SyntaxError', async () => {
    writeCreds(validCreds({ expiresAt: new Date(Date.now() - 3600_000).toISOString() }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })) as unknown as typeof fetch;
    const origTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const err = await getToken().then(
        () => undefined,
        (e: unknown) => e,
      );
      // Regression: res.json() used to run before the res.ok check, so the
      // HTML body threw "Unexpected token '<'" and shadowed the HTTP 502.
      expect(err).not.toBeInstanceOf(SyntaxError);
      expect(err).toBeInstanceOf(AuthError);
    } finally {
      globalThis.fetch = originalFetch;
      if (origTty) Object.defineProperty(process.stdin, 'isTTY', origTty);
    }
  });

  it('throws the descriptive refresh error (not a bare TypeError) when a 200 lacks `response`', async () => {
    // Regression: a 200 { status: 'success' } with no `response` payload used
    // to hit the destructuring line and throw a bare TypeError instead of the
    // intended "Token refresh failed…" error.
    writeCreds(validCreds({ expiresAt: new Date(Date.now() - 3600_000).toISOString() }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
    try {
      const err = await refreshAccessToken().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TypeError);
      expect((err as Error).message).toMatch(/Token refresh failed/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('still surfaces AuthError (exit 3) when the auth server rejects the refresh token', async () => {
    writeCreds(validCreds({ expiresAt: new Date(Date.now() - 3600_000).toISOString() }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'error', reason: 'invalid_grant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
    const origTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const err = await getToken().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).exitCode).toBe(ExitCode.AUTH_ERROR);
    } finally {
      globalThis.fetch = originalFetch;
      if (origTty) Object.defineProperty(process.stdin, 'isTTY', origTty);
    }
  });
});

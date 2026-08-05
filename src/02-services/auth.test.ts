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
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Credentials, getToken, loadCredentials, logout, whoami } from './auth.ts';

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
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getToken                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

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
});

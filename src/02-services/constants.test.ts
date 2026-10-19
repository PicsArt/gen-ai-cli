/**
 * Spec for the constants service. These tests define what the contract
 * should be; deviations from the implementation get flagged here.
 */
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_URL,
  CLI_VERSION,
  getApiUrl,
  getCredentialsPath,
  getDeviceAuthUrl,
  getDeviceClientId,
  getOAuthAuthUrl,
  getTokenExchangeUrl,
  getTokenRefreshUrl,
  getUploadUrl,
  makeHeaders,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_PORT,
  OAUTH_SCOPE,
  resolveUserPath,
  UPLOAD_URL,
} from './constants.ts';

/* ─────────────────────────────────────────────────────────────────────── */
/*  Constants                                                             */
/* ─────────────────────────────────────────────────────────────────────── */

describe('constants — defaults', () => {
  it('API_URL and UPLOAD_URL are HTTPS Picsart endpoints', () => {
    expect(API_URL.startsWith('https://')).toBe(true);
    expect(API_URL).toContain('picsart');
    expect(UPLOAD_URL.startsWith('https://')).toBe(true);
    expect(UPLOAD_URL).toContain('picsart');
  });

  it('CLI_VERSION is a non-empty string', () => {
    expect(typeof CLI_VERSION).toBe('string');
    expect(CLI_VERSION.length).toBeGreaterThan(0);
  });

  it('OAuth constants are well-formed', () => {
    expect(OAUTH_CLIENT_ID.length).toBeGreaterThan(0);
    expect(Number.isInteger(OAUTH_REDIRECT_PORT)).toBe(true);
    expect(OAUTH_REDIRECT_PORT).toBeGreaterThan(1024);
    expect(OAUTH_SCOPE.length).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getApiUrl / getUploadUrl                                              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getApiUrl / getUploadUrl', () => {
  let originalApi: string | undefined;
  let originalUpload: string | undefined;

  beforeEach(() => {
    originalApi = process.env.GEN_AI_API_URL;
    originalUpload = process.env.GEN_AI_UPLOAD_URL;
    delete process.env.GEN_AI_API_URL;
    delete process.env.GEN_AI_UPLOAD_URL;
  });
  afterEach(() => {
    if (originalApi !== undefined) process.env.GEN_AI_API_URL = originalApi;
    else delete process.env.GEN_AI_API_URL;
    if (originalUpload !== undefined) process.env.GEN_AI_UPLOAD_URL = originalUpload;
    else delete process.env.GEN_AI_UPLOAD_URL;
  });

  it('returns the default URL when no env is set', () => {
    expect(getApiUrl()).toBe(API_URL);
    expect(getUploadUrl()).toBe(UPLOAD_URL);
  });

  it('honors GEN_AI_API_URL env override', () => {
    process.env.GEN_AI_API_URL = 'https://stage.example.com';
    expect(getApiUrl()).toBe('https://stage.example.com');
  });

  it('honors GEN_AI_UPLOAD_URL env override', () => {
    process.env.GEN_AI_UPLOAD_URL = 'https://upload.stage.example.com';
    expect(getUploadUrl()).toBe('https://upload.stage.example.com');
  });

  it('accepts http://localhost for local dev', () => {
    process.env.GEN_AI_API_URL = 'http://localhost:3000';
    expect(getApiUrl()).toBe('http://localhost:3000');
  });

  it('rejects non-HTTPS, non-localhost URLs', () => {
    process.env.GEN_AI_API_URL = 'http://insecure.example.com';
    expect(() => getApiUrl()).toThrow(/HTTPS|localhost/i);
  });

  it('rejects http hosts that merely START with "localhost" (localhost.evil.com)', () => {
    process.env.GEN_AI_API_URL = 'http://localhost.evil.com';
    expect(() => getApiUrl()).toThrow(/HTTPS|localhost/i);
    process.env.GEN_AI_API_URL = 'http://localhost-impostor:3000';
    expect(() => getApiUrl()).toThrow(/HTTPS|localhost/i);
  });

  it('accepts http://127.0.0.1 with a port for local dev', () => {
    process.env.GEN_AI_API_URL = 'http://127.0.0.1:3000';
    expect(getApiUrl()).toBe('http://127.0.0.1:3000');
  });

  it('rejects strings that are not URLs at all', () => {
    process.env.GEN_AI_API_URL = 'not a url';
    expect(() => getApiUrl()).toThrow(/valid URL/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  OAuth helpers                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('OAuth URL helpers', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.GEN_AI_API_URL;
  });
  afterEach(() => {
    if (original !== undefined) process.env.GEN_AI_API_URL = original;
    else delete process.env.GEN_AI_API_URL;
  });

  it('SSO base is picsart.com when API is production', () => {
    delete process.env.GEN_AI_API_URL;
    expect(getOAuthAuthUrl()).toBe('https://picsart.com/sso');
  });

  it('SSO base follows the API host, dropping a leading api label', () => {
    process.env.GEN_AI_API_URL = 'https://api.example.com';
    expect(getOAuthAuthUrl()).toBe('https://example.com/sso');
  });

  it('drops a hyphenated api-<env> label too', () => {
    // Shape of a non-production endpoint: api-<env>.<site> → <site>/sso.
    process.env.GEN_AI_API_URL = 'https://api-alt.example.com';
    expect(getOAuthAuthUrl()).toBe('https://example.com/sso');
  });

  it('uses the host as-is when there is no api label to strip', () => {
    process.env.GEN_AI_API_URL = 'http://localhost:3000';
    expect(getOAuthAuthUrl()).toBe('http://localhost:3000/sso');
  });

  it('keeps an explicit port when stripping the api label', () => {
    // A neutral region label here: the GitHub mirror guard blocks anything
    // resembling a non-production endpoint, even on a fake example.com host.
    process.env.GEN_AI_API_URL = 'https://api-eu.example.com:8443';
    expect(getOAuthAuthUrl()).toBe('https://example.com:8443/sso');
  });

  it('token exchange URL is under the API host', () => {
    delete process.env.GEN_AI_API_URL;
    expect(getTokenExchangeUrl()).toContain(API_URL);
    expect(getTokenExchangeUrl()).toContain('exchange');
  });

  it('token refresh URL is under the API host', () => {
    delete process.env.GEN_AI_API_URL;
    expect(getTokenRefreshUrl()).toContain(API_URL);
    expect(getTokenRefreshUrl()).toContain('refresh');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getCredentialsPath                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getCredentialsPath', () => {
  let originalApi: string | undefined;

  beforeEach(() => {
    originalApi = process.env.GEN_AI_API_URL;
    delete process.env.GEN_AI_API_URL;
  });
  afterEach(() => {
    if (originalApi !== undefined) process.env.GEN_AI_API_URL = originalApi;
    else delete process.env.GEN_AI_API_URL;
  });

  it('lives under the data dir and is named credentials.json', () => {
    const credPath = getCredentialsPath();
    expect(credPath.endsWith('credentials.json')).toBe(true);
    expect(credPath).toContain('.gen-ai');
  });

  // Production keeps the legacy filename so upgrading the CLI does not orphan
  // every existing user's session.
  it('uses the unsuffixed legacy filename for production', () => {
    process.env.GEN_AI_API_URL = API_URL;
    expect(path.basename(getCredentialsPath())).toBe('credentials.json');
  });

  // The refresh endpoint's host is derived from GEN_AI_API_URL at call time, so
  // a shared file lets a stage refresh token be POSTed to the prod auth server
  // (and vice versa), which the server rejects with invalid_grant.
  it('gives a non-production environment its own file', () => {
    process.env.GEN_AI_API_URL = 'https://api.example-stage.test';
    const stagePath = getCredentialsPath();
    expect(path.basename(stagePath)).toBe('credentials.api.example-stage.test.json');

    delete process.env.GEN_AI_API_URL;
    expect(stagePath).not.toBe(getCredentialsPath());
  });

  it('keeps distinct non-production environments apart', () => {
    process.env.GEN_AI_API_URL = 'https://api.example-stage.test';
    const stage = getCredentialsPath();
    process.env.GEN_AI_API_URL = 'http://localhost:3000';
    const local = getCredentialsPath();
    expect(stage).not.toBe(local);
  });

  // A host is a path segment here — a colon in an authority (localhost:3000)
  // must not produce a surprising filename or escape the data dir.
  it('produces a filesystem-safe name for a host with a port', () => {
    process.env.GEN_AI_API_URL = 'http://localhost:3000';
    const base = path.basename(getCredentialsPath());
    expect(base.startsWith('credentials.')).toBe(true);
    expect(base.endsWith('.json')).toBe(true);
    expect(base).not.toContain(path.sep);
    expect(base).not.toContain(':');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  makeHeaders                                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('makeHeaders', () => {
  it('includes Authorization Bearer + user id + content type', () => {
    const h = makeHeaders('abc123', 'user-7');
    expect(h.Authorization).toBe('Bearer abc123');
    expect(h['user-id']).toBe('user-7');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('includes platform / touchpoint identifiers', () => {
    const h = makeHeaders('t', 'u');
    expect(h.platform).toBeDefined();
    expect(h.touchpoint).toBeDefined();
  });

  it('returns a fresh object on each call', () => {
    const h1 = makeHeaders('t', 'u');
    const h2 = makeHeaders('t', 'u');
    expect(h1).not.toBe(h2);
    expect(h1).toEqual(h2);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  resolveUserPath                                                       */
/* ─────────────────────────────────────────────────────────────────────── */

describe('resolveUserPath', () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = '/tmp/fake-home';
  });
  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
  });

  it('returns empty string for empty input', () => {
    expect(resolveUserPath('')).toBe('');
  });

  it('expands a lone ~ to $HOME', () => {
    expect(resolveUserPath('~')).toBe('/tmp/fake-home');
  });

  it('expands ~/... to $HOME/...', () => {
    expect(resolveUserPath('~/docs')).toBe(path.join('/tmp/fake-home', 'docs'));
  });

  it('leaves an absolute path untouched', () => {
    expect(resolveUserPath('/usr/local/bin')).toBe('/usr/local/bin');
  });

  it('leaves a relative path without leading ~ untouched', () => {
    expect(resolveUserPath('./relative')).toBe('./relative');
    expect(resolveUserPath('plain')).toBe('plain');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getDeviceAuthUrl / getDeviceClientId                                   */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getDeviceAuthUrl / getDeviceClientId', () => {
  let originalApi: string | undefined;
  let originalAuth: string | undefined;
  let originalCid: string | undefined;
  beforeEach(() => {
    originalApi = process.env.GEN_AI_API_URL;
    originalAuth = process.env.GEN_AI_DEVICE_AUTH_URL;
    originalCid = process.env.GEN_AI_DEVICE_CLIENT_ID;
    delete process.env.GEN_AI_API_URL;
    delete process.env.GEN_AI_DEVICE_AUTH_URL;
    delete process.env.GEN_AI_DEVICE_CLIENT_ID;
  });
  afterEach(() => {
    if (originalApi === undefined) delete process.env.GEN_AI_API_URL;
    else process.env.GEN_AI_API_URL = originalApi;
    if (originalAuth === undefined) delete process.env.GEN_AI_DEVICE_AUTH_URL;
    else process.env.GEN_AI_DEVICE_AUTH_URL = originalAuth;
    if (originalCid === undefined) delete process.env.GEN_AI_DEVICE_CLIENT_ID;
    else process.env.GEN_AI_DEVICE_CLIENT_ID = originalCid;
  });

  it('derives prod auth base + client id from the default API host', () => {
    delete process.env.GEN_AI_API_URL;
    expect(getDeviceAuthUrl()).toBe('https://auth.picsart.com/api');
    expect(getDeviceClientId()).toBe('auth-service-Gen-AI-CLI');
  });
  it('derives stage auth base + client id from the stage API host', () => {
    process.env.GEN_AI_API_URL = 'https://api.example-stage.test';
    expect(getDeviceAuthUrl()).toBe('https://auth.example-stage.test/api');
    expect(getDeviceClientId()).toBe('auth-service-gen-ai-cli');
  });
  it('swaps a hyphenated api-<x> label for auth-<x>', () => {
    process.env.GEN_AI_API_URL = 'https://api-eu.example.test';
    expect(getDeviceAuthUrl()).toBe('https://auth-eu.example.test/api');
    expect(getDeviceClientId()).toBe('auth-service-Gen-AI-CLI');
  });
  it('honors explicit overrides', () => {
    process.env.GEN_AI_DEVICE_AUTH_URL = 'https://auth.example-dev.test/api';
    process.env.GEN_AI_DEVICE_CLIENT_ID = 'custom-cli';
    expect(getDeviceAuthUrl()).toBe('https://auth.example-dev.test/api');
    expect(getDeviceClientId()).toBe('custom-cli');
  });
});

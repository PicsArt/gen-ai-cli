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
  it('lives under the data dir and is named credentials.json', () => {
    const credPath = getCredentialsPath();
    expect(credPath.endsWith('credentials.json')).toBe(true);
    expect(credPath).toContain('.gen-ai');
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

import * as path from 'node:path';
import { getDataDir } from '#infra/utils/data-dir.ts';

export const API_URL = 'https://api.picsart.com';
export const UPLOAD_URL = 'https://upload.picsart.com';

/** CLI version — read from package.json at runtime. */
export const CLI_VERSION = process.env.PICSART_CLI_VERSION ?? '0.0.0-dev';

/* ── OAuth2 ─────────────────────────────────────────────────── */
export const OAUTH_CLIENT_ID = 'auth-service-miniapps-developer';
export const OAUTH_REDIRECT_PORT = 5161;
export const OAUTH_SCOPE = 'user-global';

/**
 * SSO base for the environment the CLI is pointed at, derived from the API host
 * rather than hardcoded per environment.
 *
 * The site host is the API host minus a leading `api` / `api-*` label:
 *   https://api.picsart.com        → https://picsart.com/sso
 *   https://api-foo.example.com    → https://example.com/sso
 *   http://localhost:3000          → http://localhost:3000/sso   (no label to strip)
 *
 * Deriving it keeps every non-production hostname out of the source — point
 * `GEN_AI_API_URL` at an environment and its SSO base follows automatically,
 * including self-hosted setups the old hardcoded mapping couldn't express.
 */
export function getOAuthAuthUrl(): string {
  const url = new URL(getApiUrl());
  const labels = url.hostname.split('.');
  const hasApiLabel = labels.length > 2 && (labels[0] === 'api' || labels[0].startsWith('api-'));
  // Keep any explicit port when stripping the api label (self-hosted setups).
  const strippedHost = url.port ? `${labels.slice(1).join('.')}:${url.port}` : labels.slice(1).join('.');
  const siteHost = hasApiLabel ? strippedHost : url.host;
  return `${url.protocol}//${siteHost}/sso`;
}

export function getTokenExchangeUrl(): string {
  return `${getApiUrl()}/mini-apps-portal/authz/oauth2/code/exchange`;
}

export function getTokenRefreshUrl(): string {
  return `${getApiUrl()}/mini-apps-portal/authz/oauth2/refresh`;
}

/* ── URLs ────────────────────────────────────────────────────── */

function validateUrl(url: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} is not a valid URL (got ${url}).`);
  }
  // Plain-http is allowed only for genuinely local hosts. A prefix test like
  // startsWith('http://localhost') would also pass http://localhost.evil.com.
  const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost)) {
    throw new Error(`${name} must use HTTPS (got ${url}). Use http://localhost for local development only.`);
  }
  return url;
}

export function getApiUrl(): string {
  return validateUrl(process.env.GEN_AI_API_URL ?? API_URL, 'GEN_AI_API_URL');
}

export function getUploadUrl(): string {
  return validateUrl(process.env.GEN_AI_UPLOAD_URL ?? UPLOAD_URL, 'GEN_AI_UPLOAD_URL');
}

export function getCredentialsPath(): string {
  return `${getDataDir()}/credentials.json`;
}

/** Build standard auth/API headers for Picsart API requests. */
export function makeHeaders(token: string, uid: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'user-id': uid,
    'country-code': 'US',
    platform: 'web',
    touchpoint: 'editor',
    'x-pa-platform': 'web',
    'x-pa-touchpoint': 'ai-studio',
    'X-Platform': 'web',
    'X-Touchpoint': 'ai-sdk.cli',
  };
}

export function resolveUserPath(input: string): string {
  if (!input) return input;
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (input === '~' && home) return home;
  if ((input.startsWith('~/') || input.startsWith(`~${path.sep}`)) && home) {
    return path.join(home, input.slice(2));
  }
  return input;
}

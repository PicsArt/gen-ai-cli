import * as path from 'node:path';
import { getDataDir } from '#infra/utils/data-dir.ts';

export const API_URL = 'https://api.picsart.com';
export const UPLOAD_URL = 'https://upload.picsart.com';

/** CLI version — read from package.json at runtime. */
export const CLI_VERSION = process.env.PICSART_CLI_VERSION ?? '0.0.0-dev';

/* ── OAuth2 (pa-authorization-server) ────────────────────────── */
export const OAUTH_REDIRECT_PORT = 5161;
export const OAUTH_SCOPE = 'user-global';

/*
 * Both login flows — the browser Authorization Code + PKCE flow (auth.ts) and
 * the headless Device Authorization Grant (device-auth.ts) — talk to
 * pa-authorization-server with the SAME public client. The `Device` in the
 * names below is historical: the device flow adopted this server first.
 */

export const DEVICE_CLIENT_ID_PROD = 'auth-service-Gen-AI-CLI';
export const DEVICE_CLIENT_ID_STAGE = 'auth-service-gen-ai-cli';

/**
 * Base URL of pa-authorization-server, derived from the API host by swapping
 * the leading `api` label for `auth` and appending `/api`:
 *   api.picsart.com             → https://auth.picsart.com/api
 *   api-<env>.<domain>          → https://auth-<env>.<domain>/api
 * Endpoints under it: `/oauth2/authorize`, `/oauth2/device_authorization`,
 * `/oauth2/token`. This is a DIFFERENT auth system from the legacy mini-apps
 * refresh URL below, with its own client registry. Override with
 * GEN_AI_DEVICE_AUTH_URL.
 */
export function getDeviceAuthUrl(): string {
  const override = process.env.GEN_AI_DEVICE_AUTH_URL;
  if (override) return validateUrl(override, 'GEN_AI_DEVICE_AUTH_URL');
  const url = new URL(getApiUrl());
  const labels = url.hostname.split('.');
  labels[0] = labels[0].replace(/^api/, 'auth');
  const host = url.port ? `${labels.join('.')}:${url.port}` : labels.join('.');
  return validateUrl(`${url.protocol}//${host}/api`, 'device auth URL');
}

/**
 * OAuth client_id for the target environment — the registration NAME, not the
 * UUID the admin UI shows (the UUIDs return `invalid_client`). Stage/dev hosts
 * use the lowercase stage client; everything else uses the prod client. The
 * two names differ in case and must be sent verbatim. Override with
 * GEN_AI_DEVICE_CLIENT_ID.
 */
export function getDeviceClientId(): string {
  const override = process.env.GEN_AI_DEVICE_CLIENT_ID;
  if (override) return override;
  const host = new URL(getDeviceAuthUrl()).hostname;
  return /-stage|-dev/.test(host) ? DEVICE_CLIENT_ID_STAGE : DEVICE_CLIENT_ID_PROD;
}

/**
 * Legacy mini-apps refresh endpoint. Nothing logs in through mini-apps any
 * more; this only keeps sessions created by older builds (credentials with no
 * `authSource`, or `'miniapps'`) alive until their refresh token lapses.
 */
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

/**
 * Credentials file for the environment the CLI is currently pointed at.
 *
 * Stage and production issue tokens from different auth servers, and
 * getTokenRefreshUrl() derives its host from GEN_AI_API_URL at call time. A
 * single shared file therefore lets one environment's refresh token be POSTed
 * to the other's auth server, which answers 400 invalid_grant and drops the
 * user back into login. Namespacing by host keeps both sessions alive.
 *
 * Production deliberately keeps the legacy unsuffixed filename so upgrading
 * the CLI does not orphan every existing user's credentials.
 */
export function getCredentialsPath(): string {
  const host = new URL(getApiUrl()).host;
  if (host === new URL(API_URL).host) return path.join(getDataDir(), 'credentials.json');
  // `host` carries a colon for non-default ports (localhost:3000) — keep the
  // name a single, portable path segment.
  const safeHost = host.replace(/[^A-Za-z0-9.-]/g, '_');
  return path.join(getDataDir(), `credentials.${safeHost}.json`);
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

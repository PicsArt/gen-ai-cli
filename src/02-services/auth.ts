import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { isNetworkError, NetworkError } from '#infra/errors/network.ts';
import type { OutputManager } from '#infra/ui-core/output.ts';
import { openInDefault } from '#infra/utils/open.ts';
import {
  getApiUrl,
  getCredentialsPath,
  getOAuthAuthUrl,
  getTokenExchangeUrl,
  getTokenRefreshUrl,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_PORT,
  OAUTH_SCOPE,
} from '#services/constants.ts';
import { type Credentials, fetchUserInfo, saveCredentials } from '#services/credentials.ts';

// Credential shape + storage/identity primitives live in credentials.ts (shared
// with the device-grant flow to avoid an import cycle); re-exported so existing
// importers of auth.ts keep working unchanged.
export type { Credentials };

/**
 * The slice of the output surface the auth flow needs. Callers that own an
 * OutputManager satisfy this structurally and pass it straight in, so the auth
 * service never reaches for a global.
 */
export type AuthNotifier = Pick<OutputManager, 'info' | 'warn'>;

/**
 * Fallback for callers below the UI layer — the execution layer receives no
 * OutputManager by design (see ExecutionDeps), yet a token can lapse mid-run.
 * Writes to stderr so stdout's machine-readable contract stays clean. An
 * interactive login in particular must never be silent: the user needs the
 * authorization URL when the browser fails to open.
 */
export const defaultAuthNotifier: AuthNotifier = {
  info: (msg: string) => process.stderr.write(`${msg}\n`),
  warn: (msg: string) => process.stderr.write(`${msg}\n`),
};

/**
 * Credentials supplied via environment variables (CI / headless mode).
 * Highest-priority auth source — every consumer of stored credentials must
 * check this first, or env-authenticated shells (which have no credentials
 * file on disk) break. An env token has no refresh token: it can only be
 * replaced by the operator, never rotated by the CLI.
 */
export function getEnvCredentials(): Credentials | null {
  const token = process.env.PICSART_ACCESS_TOKEN;
  const uid = process.env.PICSART_USER_ID;
  if (!token || !uid) return null;
  return {
    token,
    refreshToken: '',
    uid,
    email: '',
    // Expiry is unknowable for an operator-supplied token — the API is the
    // authority, and a stale token surfaces as a 401.
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** Host of an API base URL, or null when it cannot be parsed. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Whether stored credentials belong to the environment this process targets.
 * Compares hosts only — scheme or trailing-slash drift in the stored value is
 * incidental and must not invalidate an otherwise good session.
 */
function matchesCurrentEnvironment(storedApiUrl: string | undefined): boolean {
  // Legacy file from a build that predates the stamp — trust it. The path is
  // already namespaced, and a genuinely foreign token still surfaces as a 401.
  if (storedApiUrl === undefined) return true;
  const stored = hostOf(storedApiUrl);
  return stored !== null && stored === hostOf(getApiUrl());
}

/**
 * The foreign environment's host when a credentials file exists but was issued
 * elsewhere, otherwise null. Used only to explain the situation to the user —
 * loadCredentials() itself just reports "no usable credentials".
 */
function foreignCredentialsHost(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(getCredentialsPath(), 'utf-8'));
    const stored = typeof raw?.apiUrl === 'string' ? raw.apiUrl : undefined;
    if (stored === undefined || matchesCurrentEnvironment(stored)) return null;
    return hostOf(stored) ?? stored;
  } catch {
    return null;
  }
}

export function loadCredentials(): Credentials | null {
  const credPath = getCredentialsPath();
  try {
    const data = fs.readFileSync(credPath, 'utf-8');
    const creds = JSON.parse(data);
    if (
      !creds ||
      typeof creds.token !== 'string' ||
      typeof creds.uid !== 'string' ||
      typeof creds.refreshToken !== 'string' ||
      typeof creds.email !== 'string' ||
      typeof creds.expiresAt !== 'string'
    )
      return null;
    if (creds.apiUrl !== undefined && typeof creds.apiUrl !== 'string') return null;
    // Credentials from another environment are unusable here: the access token
    // earns a 401 and the refresh token is rejected with invalid_grant.
    if (!matchesCurrentEnvironment(creds.apiUrl)) return null;
    return creds as Credentials;
  } catch {
    return null;
  }
}

/* ── HTML helpers ────────────────────────────────────────────── */

/** Show a styled success page in the browser after OAuth callback. */
function respondWithSuccessPage(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>gen-ai — Login Successful</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #0d1117; color: #e1e4ed; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; }
  .card { text-align: center; padding: 48px; border-radius: 16px; background: #1a1d27;
    border: 1px solid #2d3148; max-width: 420px; }
  .check { font-size: 48px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; background: linear-gradient(135deg, #E859B4, #BD99F8, #9A1A89);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  p { color: #8b8fa7; font-size: 14px; line-height: 1.6; margin: 0; }
  .hint { margin-top: 20px; font-size: 12px; color: #555; }
</style>
<script>setTimeout(() => window.close(), 3000)</script>
</head><body>
<div class="card">
  <div class="check">✓</div>
  <h1>Login Successful</h1>
  <p>You're authenticated. Return to your terminal to continue.</p>
  <p class="hint">This tab will try to close automatically...</p>
</div>
</body></html>`);
}

/** Show an error page in the browser when OAuth fails. */
function respondWithErrorPage(res: http.ServerResponse, message: string): void {
  res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>gen-ai — Login Failed</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #0d1117; color: #e1e4ed; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; }
  .card { text-align: center; padding: 48px; border-radius: 16px; background: #1a1d27;
    border: 1px solid #2d3148; max-width: 420px; }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; color: #F8495A; }
  p { color: #8b8fa7; font-size: 14px; line-height: 1.6; margin: 0; }
</style>
</head><body>
<div class="card">
  <div class="icon">✕</div>
  <h1>Login Failed</h1>
  <p>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</p>
  <p style="margin-top:12px">Return to your terminal for details.</p>
</div>
</body></html>`);
}

/* ── OAuth2 Authorization Code flow ─────────────────────────── */

interface TokenResponse {
  response: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_token_expires_in: number;
  };
  status: 'success' | 'error';
  message?: string;
  reason?: string;
}

function tryPort(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

async function findAvailableServer(): Promise<{ server: http.Server; port: number }> {
  for (let p = OAUTH_REDIRECT_PORT; p < OAUTH_REDIRECT_PORT + 3; p++) {
    try {
      const server = await tryPort(p);
      return { server, port: p };
    } catch {
      /* port busy, try next */
    }
  }
  throw new Error(`Ports ${OAUTH_REDIRECT_PORT}-${OAUTH_REDIRECT_PORT + 2} are all busy`);
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if ('closeAllConnections' in server)
      (server as http.Server & { closeAllConnections: () => void }).closeAllConnections();
    server.close(() => resolve());
  });
}

/**
 * Wait until a response has been flushed to the socket. Closing the server
 * with closeAllConnections() right after res.end() can destroy the socket
 * before the browser receives the success/error page.
 */
function waitForResponseFinish(res: http.ServerResponse): Promise<void> {
  if (res.writableFinished) return Promise.resolve();
  return new Promise((resolve) => {
    res.once('finish', resolve);
    res.once('close', resolve);
  });
}

/**
 * Parse a token-endpoint response body without letting a non-JSON error page
 * (proxy 502s return HTML) turn into a bare SyntaxError that shadows the
 * real HTTP failure.
 */
async function parseTokenResponse(res: Response): Promise<TokenResponse | null> {
  try {
    return (await res.json()) as TokenResponse;
  } catch {
    return null;
  }
}

/**
 * Timeout for the token-exchange and user-info calls. These run AFTER the
 * callback handler sets `handled = true`, which disarms login()'s 5-minute
 * timer — without their own AbortSignal a stalled endpoint would leave the
 * login promise pending forever with no message to the user.
 */
const TOKEN_FETCH_TIMEOUT_MS = 30_000;

async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch(getTokenExchangeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
  });
  const data = await parseTokenResponse(res);
  // `data.response` guarded too: a 200 missing the payload must surface the
  // descriptive error below, not a bare TypeError from the destructuring.
  if (!res.ok || !data || data.status !== 'success' || !data.response) {
    throw new Error(`Token exchange failed: ${data?.message ?? data?.reason ?? `HTTP ${res.status}`}`);
  }
  if (!data.response.access_token || !data.response.refresh_token) {
    throw new Error('Missing tokens in exchange response');
  }
  return data;
}

export async function login(notify: AuthNotifier): Promise<Credentials> {
  const state = crypto.randomBytes(16).toString('hex');
  const { server, port } = await findAvailableServer();
  const redirectUri = `http://localhost:${port}`;

  // TODO: Add PKCE (RFC 7636) — required for public CLI clients per RFC 8252.
  // Needs: generate code_verifier/code_challenge here, send code_verifier in token exchange.
  // Blocked on confirming Picsart SSO supports code_challenge_method=S256.
  const authUrl = `${getOAuthAuthUrl()}?${new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    scope: OAUTH_SCOPE,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  })}`;

  return new Promise<Credentials>((resolve, reject) => {
    let handled = false;

    const timeout = setTimeout(
      () => {
        if (!handled) {
          handled = true;
          closeServer(server);
          reject(new Error('OAuth login timed out after 5 minutes. Please try again.'));
        }
      },
      5 * 60 * 1000,
    );

    server.on('request', async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!req.url || handled) {
        res.writeHead(404).end();
        return;
      }
      const parsed = new URL(req.url, redirectUri);
      if (parsed.pathname !== '/') {
        // Answer favicon/stray requests instead of leaving the socket hanging.
        res.writeHead(404).end();
        return;
      }

      const code = parsed.searchParams.get('code');
      const returnedState = parsed.searchParams.get('state');
      const errorParam = parsed.searchParams.get('error');
      const errorDesc = parsed.searchParams.get('error_description');

      if (errorParam) {
        handled = true;
        const msg = `OAuth error: ${errorParam}${errorDesc ? ` - ${errorDesc}` : ''}`;
        respondWithErrorPage(res, msg);
        clearTimeout(timeout);
        await waitForResponseFinish(res);
        await closeServer(server);
        reject(new Error(msg));
        return;
      }

      if (returnedState !== state) {
        // Don't set handled — allow the real callback to arrive after a spurious request
        respondWithErrorPage(res, 'State mismatch — please try logging in again.');
        return;
      }

      // Valid callback — lock out further requests
      handled = true;

      if (!code) {
        respondWithErrorPage(res, 'No authorization code received.');
        clearTimeout(timeout);
        await waitForResponseFinish(res);
        await closeServer(server);
        reject(new Error('No authorization code in callback'));
        return;
      }

      try {
        const tokenData = await exchangeCode(code, redirectUri);
        const { access_token, refresh_token, expires_in, refresh_token_expires_in } = tokenData.response;

        const user = await fetchUserInfo(access_token);

        const creds: Credentials = {
          token: access_token,
          refreshToken: refresh_token,
          uid: user.uid,
          email: user.email,
          expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
          refreshExpiresAt: refresh_token_expires_in
            ? new Date(Date.now() + refresh_token_expires_in * 1000).toISOString()
            : undefined,
          apiUrl: getApiUrl(),
        };
        saveCredentials(creds);

        respondWithSuccessPage(res);
        clearTimeout(timeout);
        await waitForResponseFinish(res);
        await closeServer(server);
        resolve(creds);
      } catch (err) {
        respondWithErrorPage(res, 'Token exchange failed. Please try again.');
        clearTimeout(timeout);
        await waitForResponseFinish(res);
        await closeServer(server);
        reject(err);
      }
    });

    notify.info('Opening browser for authorization...');
    notify.info(`If browser doesn't open, visit: ${authUrl}`);
    openInDefault(authUrl);
  });
}

/* ── Token refresh (with mutex to prevent concurrent rotations) ── */

let refreshPromise: Promise<Credentials> | null = null;

export function refreshAccessToken(): Promise<Credentials> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function doRefresh(): Promise<Credentials> {
  const creds = loadCredentials();
  if (!creds?.refreshToken) {
    throw new Error('No refresh token. Run "gen-ai login" to authenticate.');
  }
  // Device-issued tokens refresh at pa-authorization-server, not the mini-apps
  // URL. Lazy import avoids a load-time cycle (device-auth imports credentials,
  // not auth). Checked before the expiry gate — the device server owns expiry.
  if (creds.authSource === 'device') {
    const { refreshDeviceToken } = await import('#services/device-auth.ts');
    const updated = await refreshDeviceToken(creds);
    saveCredentials(updated);
    return updated;
  }
  if (creds.refreshExpiresAt && new Date(creds.refreshExpiresAt) <= new Date()) {
    throw new Error('Refresh token expired. Run "gen-ai login" to re-authenticate.');
  }

  const res = await fetch(getTokenRefreshUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refresh_token: creds.refreshToken }),
    signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
  });
  const data = await parseTokenResponse(res);

  // `data.response` guarded too: a 200 missing the payload must surface the
  // descriptive error below, not a bare TypeError from the destructuring.
  if (!res.ok || !data || data.status !== 'success' || !data.response) {
    const reason = data?.message ?? data?.reason ?? `HTTP ${res.status}`;
    const host = hostOf(getTokenRefreshUrl()) ?? getTokenRefreshUrl();
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Refresh token revoked by ${host} (${reason}).`);
    }
    throw new Error(`Token refresh failed at ${host}: ${reason}`);
  }

  const { access_token, refresh_token, expires_in, refresh_token_expires_in } = data.response;
  const updated: Credentials = {
    ...creds,
    token: access_token,
    refreshToken: refresh_token,
    expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
    refreshExpiresAt: refresh_token_expires_in
      ? new Date(Date.now() + refresh_token_expires_in * 1000).toISOString()
      : creds.refreshExpiresAt,
    apiUrl: getApiUrl(),
  };
  saveCredentials(updated);
  return updated;
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Get a valid access token. Priority:
 * 1. Environment variables (CI mode)
 * 2. Cached credentials (if access token valid)
 * 3. Auto-refresh (if refresh token valid)
 * 4. Auto-login (opens browser, interactive only)
 */
export async function getToken(notify: AuthNotifier = defaultAuthNotifier): Promise<{ token: string; uid: string }> {
  // 1. CI / env override
  const envCreds = getEnvCredentials();
  if (envCreds) return { token: envCreds.token, uid: envCreds.uid };

  // 2. Cached credentials
  const creds = loadCredentials();
  // Kept so the failure can be reported instead of silently becoming
  // "Not authenticated" three steps later.
  let refreshFailure: string | null = null;

  if (creds) {
    // 3. Access token still valid (60s buffer)
    if (new Date(creds.expiresAt) > new Date(Date.now() + 60_000)) {
      return { token: creds.token, uid: creds.uid };
    }

    // 4. Try refresh
    try {
      const refreshed = await refreshAccessToken();
      return { token: refreshed.token, uid: refreshed.uid };
    } catch (err) {
      // A transport failure means we never learned whether the credentials are
      // still good — reporting "not authenticated" here sends the user off to
      // re-run `gen-ai login`, which cannot fix an offline/sandboxed shell.
      if (isNetworkError(err)) {
        throw new NetworkError(`could not refresh the access token (${(err as Error).message})`);
      }
      // Genuine rejection from the auth server — fall through to auto-login,
      // but keep the reason: it is the only explanation the user ever gets.
      refreshFailure = (err as Error).message;
    }
  }

  // Credentials exist but belong to another environment — say so, rather than
  // letting it read as "you were never logged in".
  const foreignHost = foreignCredentialsHost();
  const mismatchHint = foreignHost
    ? `Stored credentials were issued for ${foreignHost}, but this command targets ${hostOf(getApiUrl()) ?? getApiUrl()}.`
    : null;

  // 5. No credentials or refresh failed — auto-login if interactive
  if (!process.stdin.isTTY) {
    const { AuthError } = await import('#infra/errors/auth.ts');
    const detail = mismatchHint ?? refreshFailure;
    throw new AuthError(
      `Not authenticated.${detail ? ` ${detail}` : ''} Set PICSART_ACCESS_TOKEN and PICSART_USER_ID env vars, or run "gen-ai login" interactively.`,
    );
  }

  if (mismatchHint) notify.warn(mismatchHint);
  else if (refreshFailure) notify.warn(refreshFailure);
  notify.info('Not logged in — starting authentication...');
  const fresh = await login(notify);
  return { token: fresh.token, uid: fresh.uid };
}

export interface LogoutResult {
  /**
   * True when PICSART_ACCESS_TOKEN + PICSART_USER_ID remain set after the
   * credentials file is removed — the shell is still authenticated via env
   * vars, and only the operator can undo that. Callers should warn.
   */
  envCredentialsActive: boolean;
}

export async function logout(): Promise<LogoutResult> {
  const credPath = getCredentialsPath();
  try {
    fs.unlinkSync(credPath);
  } catch {
    /* already removed */
  }
  return { envCredentialsActive: getEnvCredentials() !== null };
}

export async function whoami(): Promise<Credentials | null> {
  // Same precedence as getToken: env credentials (CI mode) win over the file.
  return getEnvCredentials() ?? loadCredentials();
}

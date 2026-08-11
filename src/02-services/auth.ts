import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { isNetworkError, NetworkError } from '#infra/errors/network.ts';
import { getOutput } from '#infra/ui-core/output.ts';
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

export interface Credentials {
  token: string;
  refreshToken: string;
  uid: string;
  email: string;
  expiresAt: string;
  refreshExpiresAt?: string;
}

/* ── Credential storage (file-based, mode 0o600) ────────────── */

function saveCredentials(creds: Credentials): void {
  const credPath = getCredentialsPath();
  const dir = path.dirname(credPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
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

async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch(getTokenExchangeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.status !== 'success') {
    throw new Error(`Token exchange failed: ${data.message ?? data.reason ?? `HTTP ${res.status}`}`);
  }
  if (!data.response.access_token || !data.response.refresh_token) {
    throw new Error('Missing tokens in exchange response');
  }
  return data;
}

async function fetchUserInfo(accessToken: string): Promise<{ uid: string; email: string }> {
  const res = await fetch(`${getApiUrl()}/gw-v2/users/show/me.json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch user info (${res.status})`);
  const data = (await res.json()) as Record<string, unknown>;
  const response = (data.response ?? data) as Record<string, unknown>;
  return {
    uid: String(response.id ?? ''),
    email: String(response.email ?? response.username ?? ''),
  };
}

export async function login(): Promise<Credentials> {
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
      if (!req.url || handled) return;
      const parsed = new URL(req.url, redirectUri);
      if (parsed.pathname !== '/') return;

      const code = parsed.searchParams.get('code');
      const returnedState = parsed.searchParams.get('state');
      const errorParam = parsed.searchParams.get('error');
      const errorDesc = parsed.searchParams.get('error_description');

      if (errorParam) {
        handled = true;
        const msg = `OAuth error: ${errorParam}${errorDesc ? ` - ${errorDesc}` : ''}`;
        respondWithErrorPage(res, msg);
        clearTimeout(timeout);
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
        };
        saveCredentials(creds);

        respondWithSuccessPage(res);
        clearTimeout(timeout);
        await closeServer(server);
        resolve(creds);
      } catch (err) {
        respondWithErrorPage(res, 'Token exchange failed. Please try again.');
        clearTimeout(timeout);
        await closeServer(server);
        reject(err);
      }
    });

    getOutput().info('Opening browser for authorization...');
    getOutput().info(`If browser doesn't open, visit: ${authUrl}`);
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
  if (creds.refreshExpiresAt && new Date(creds.refreshExpiresAt) <= new Date()) {
    throw new Error('Refresh token expired. Run "gen-ai login" to re-authenticate.');
  }

  const res = await fetch(getTokenRefreshUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refresh_token: creds.refreshToken }),
  });
  const data = (await res.json()) as TokenResponse;

  if (!res.ok || data.status !== 'success') {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Refresh token revoked. Run "gen-ai login" to re-authenticate.');
    }
    throw new Error(`Token refresh failed: ${data.message ?? data.reason ?? `HTTP ${res.status}`}`);
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
export async function getToken(): Promise<{ token: string; uid: string }> {
  // 1. CI / env override
  const envToken = process.env.PICSART_ACCESS_TOKEN;
  const envUid = process.env.PICSART_USER_ID;
  if (envToken && envUid) return { token: envToken, uid: envUid };

  // 2. Cached credentials
  const creds = loadCredentials();

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
      // Genuine rejection from the auth server — fall through to auto-login.
    }
  }

  // 5. No credentials or refresh failed — auto-login if interactive
  if (!process.stdin.isTTY) {
    const { AuthError } = await import('#infra/errors/auth.ts');
    throw new AuthError(
      'Not authenticated. Set PICSART_ACCESS_TOKEN and PICSART_USER_ID env vars, or run "gen-ai login" interactively.',
    );
  }

  getOutput().info('Not logged in — starting authentication...');
  const fresh = await login();
  return { token: fresh.token, uid: fresh.uid };
}

export async function logout(): Promise<void> {
  const credPath = getCredentialsPath();
  try {
    fs.unlinkSync(credPath);
  } catch {
    /* already removed */
  }
}

export async function whoami(): Promise<Credentials | null> {
  return loadCredentials();
}

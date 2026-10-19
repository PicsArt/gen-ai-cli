/**
 * OAuth2 Device Authorization Grant (RFC 8628) — headless CLI login.
 *
 * Talks to pa-authorization-server (a DIFFERENT auth system from the mini-apps
 * flow in auth.ts), which returns standard OAuth bodies. The user approves in a
 * browser anywhere; the CLI polls the token endpoint until approval lands.
 */
import { AuthError } from '#infra/errors/auth.ts';
import { isNetworkError, NetworkError } from '#infra/errors/network.ts';
import type { OutputManager } from '#infra/ui-core/output.ts';
import { getApiUrl, getDeviceAuthUrl, getDeviceClientId, OAUTH_SCOPE } from '#services/constants.ts';
import { type Credentials, fetchUserInfo, saveCredentials } from '#services/credentials.ts';

const DEVICE_FETCH_TIMEOUT_MS = 30_000;

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval: number;
  expires_in: number;
}

/** Parse a JSON body defensively — a proxy's HTML 5xx must not become a bare SyntaxError. */
async function parseJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  let res: Response;
  try {
    res = await fetch(`${getDeviceAuthUrl()}/oauth2/device_authorization`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form({ client_id: getDeviceClientId(), scope: OAUTH_SCOPE }),
      signal: AbortSignal.timeout(DEVICE_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (isNetworkError(err)) {
      throw new NetworkError(`could not reach the auth server (${(err as Error).message})`);
    }
    throw err;
  }
  const data = await parseJson(res);
  if (!res.ok || !data) {
    throw new AuthError(`Device authorization failed: ${String(data?.error ?? `HTTP ${res.status}`)}`);
  }
  // The fields RFC 8628 §3.2 marks REQUIRED must be present and well-typed — a
  // partial body (e.g. a missing expires_in) would make the poll loop's expiry
  // NaN, so it could spin forever.
  if (
    typeof data.device_code !== 'string' ||
    typeof data.user_code !== 'string' ||
    typeof data.verification_uri !== 'string' ||
    typeof data.expires_in !== 'number'
  ) {
    throw new AuthError('Device authorization returned an incomplete response.');
  }
  // `interval` is OPTIONAL (§3.2): default to 5s when the server omits it — and
  // also when it is zero, negative, or non-finite, which would make the poll loop
  // hammer the server or sleep on NaN.
  if (typeof data.interval !== 'number' || !Number.isFinite(data.interval) || data.interval <= 0) {
    data.interval = 5;
  }
  // Clamp the expiry: a non-positive/non-finite value, or an absurd one (e.g. 1e40)
  // that would overflow `Date.now() + expires_in*1000` into an invalid timestamp,
  // is pinned to a sane range. 86_400s (24h) is well above RFC-typical lifetimes.
  const MAX_EXPIRES_IN = 86_400;
  if (!Number.isFinite(data.expires_in) || data.expires_in <= 0) data.expires_in = 300;
  else if (data.expires_in > MAX_EXPIRES_IN) data.expires_in = MAX_EXPIRES_IN;
  return data as unknown as DeviceCodeResponse;
}

export interface DeviceTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  token_type: string;
}

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Sleep that also wakes immediately if `signal` aborts, so a cancelled login
 *  does not stay blocked for the rest of the poll interval. */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/** The abort signal for a poll request: the caller's signal (if any) combined
 *  with a per-request timeout, so a stalled request can't hang forever even when
 *  the caller never aborts theirs. */
function pollRequestSignal(callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(DEVICE_FETCH_TIMEOUT_MS);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

/**
 * Poll the token endpoint until the user approves (RFC 8628 §3.5). Waits one
 * `interval` between polls, permanently adds 5s on `slow_down`, and stops with a
 * clear AuthError on denial/expiry. A transport failure is a NetworkError, never
 * an auth failure. `sleep` is injectable so tests run without real timers.
 */
export async function pollForToken(
  deviceCode: string,
  intervalSeconds: number,
  expiresAtMs: number,
  opts?: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void> },
): Promise<DeviceTokenResponse> {
  const sleep = opts?.sleep ?? ((ms: number) => sleepAbortable(ms, opts?.signal));
  let interval = intervalSeconds;
  for (;;) {
    if (opts?.signal?.aborted) throw new AuthError('Login cancelled.');
    if (Date.now() > expiresAtMs) {
      throw new AuthError('The code expired before approval. Run login again.');
    }
    await sleep(interval * 1000);
    // Re-check after the wait: an abort during the sleep must surface as a clean
    // cancellation, not as the aborted fetch below masquerading as a network error.
    if (opts?.signal?.aborted) throw new AuthError('Login cancelled.');

    let res: Response;
    try {
      res = await fetch(`${getDeviceAuthUrl()}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form({ grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: getDeviceClientId() }),
        signal: pollRequestSignal(opts?.signal),
      });
    } catch (err) {
      if (isNetworkError(err)) {
        throw new NetworkError(`could not reach the auth server (${(err as Error).message})`);
      }
      throw err;
    }

    const data = await parseJson(res);
    if (res.ok && data && typeof data.access_token === 'string') {
      // A 200 must carry a usable token pair: without a refresh_token and a
      // numeric expires_in the saved credentials are unusable or get a NaN expiry.
      if (typeof data.refresh_token !== 'string' || typeof data.expires_in !== 'number') {
        throw new AuthError('The auth server returned an incomplete token response.');
      }
      return data as unknown as DeviceTokenResponse;
    }

    const error = data?.error;
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') {
      interval += 5;
      continue;
    }
    if (error === 'access_denied') throw new AuthError('Login was denied in the browser.');
    if (error === 'expired_token') {
      throw new AuthError('The code expired before approval. Run login again.');
    }
    throw new AuthError(`Login failed: ${String(error ?? `HTTP ${res.status}`)}`);
  }
}

/**
 * Renew a device-sourced credential at pa-authorization-server. Uses the
 * standard `refresh_token` grant (form-encoded, public client). The server runs
 * with reuseRefreshTokens=false, so each call returns a new refresh token that
 * the caller must persist.
 */
export async function refreshDeviceToken(creds: Credentials): Promise<Credentials> {
  let res: Response;
  try {
    res = await fetch(`${getDeviceAuthUrl()}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: getDeviceClientId() }),
      signal: AbortSignal.timeout(DEVICE_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (isNetworkError(err)) {
      throw new NetworkError(`could not refresh the access token (${(err as Error).message})`);
    }
    throw err;
  }
  const data = await parseJson(res);
  if (!res.ok || !data || typeof data.access_token !== 'string') {
    if (res.status === 401 || res.status === 403) {
      throw new AuthError('Session expired. Run "gen-ai login --device" to re-authenticate.');
    }
    throw new AuthError(`Token refresh failed: ${String(data?.error ?? `HTTP ${res.status}`)}`);
  }
  // A 200 must carry a usable rotated pair: without a refresh_token and a numeric
  // expires_in the saved credentials would be unusable or get a NaN/0 expiry.
  if (typeof data.refresh_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new AuthError('The auth server returned an incomplete token refresh response.');
  }
  const refreshSec = typeof data.refresh_token_expires_in === 'number' ? data.refresh_token_expires_in : undefined;
  return {
    ...creds,
    token: data.access_token as string,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    refreshExpiresAt: refreshSec ? new Date(Date.now() + refreshSec * 1000).toISOString() : creds.refreshExpiresAt,
    apiUrl: getApiUrl(),
    authSource: 'device',
  };
}

/**
 * Full headless login: request a code pair, show it to the user, poll until they
 * approve in a browser, fetch their identity, and persist device-tagged creds.
 * `out` is the injected output surface; `opts.signal` cancels the poll.
 */
export async function deviceLogin(
  out: Pick<OutputManager, 'info'>,
  opts?: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void> },
): Promise<Credentials> {
  const codes = await requestDeviceCode();
  out.info(`To sign in, open: ${codes.verification_uri}`);
  out.info(`And enter code:   ${codes.user_code}`);
  if (codes.verification_uri_complete) {
    out.info(`Or open directly: ${codes.verification_uri_complete}`);
  }

  const expiresAtMs = Date.now() + codes.expires_in * 1000;
  const token = await pollForToken(codes.device_code, codes.interval, expiresAtMs, {
    signal: opts?.signal,
    sleep: opts?.sleep,
  });
  const user = await fetchUserInfo(token.access_token);

  const creds: Credentials = {
    token: token.access_token,
    refreshToken: token.refresh_token,
    uid: user.uid,
    email: user.email,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    refreshExpiresAt: token.refresh_token_expires_in
      ? new Date(Date.now() + token.refresh_token_expires_in * 1000).toISOString()
      : undefined,
    apiUrl: getApiUrl(),
    authSource: 'device',
  };
  saveCredentials(creds);
  return creds;
}

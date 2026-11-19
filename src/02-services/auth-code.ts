/**
 * OAuth2 Authorization Code + PKCE primitives for the browser login in auth.ts.
 *
 * Talks to pa-authorization-server with the same public client as the device
 * flow (device-auth.ts). Kept out of auth.ts so the callback-server
 * orchestration there stays readable and under the file-size limit.
 */
import * as crypto from 'node:crypto';
import { AuthError } from '#infra/errors/auth.ts';
import { getDeviceAuthUrl, getDeviceClientId } from '#services/constants.ts';

/**
 * Timeout for the token exchange. It runs AFTER login()'s callback handler has
 * disarmed the 5-minute login timer — without its own AbortSignal a stalled
 * endpoint would leave the login promise pending forever.
 */
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000;

/** Standard OAuth token response (RFC 6749 §5.1), narrowed to what the CLI stores. */
export interface AuthServerTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in?: number;
}

/** PKCE pair (RFC 7636, S256): the verifier stays local, the challenge goes in the authorize URL. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Redeem an authorization code at the auth server's token endpoint. The CLI is
 * a public client (no secret): the PKCE verifier is what proves this process
 * started the login.
 */
export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<AuthServerTokens> {
  const res = await fetch(`${getDeviceAuthUrl()}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: getDeviceClientId(),
      code_verifier: codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
  });

  let data: Record<string, unknown> | null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // A proxy's HTML 5xx must report the HTTP failure, not a bare SyntaxError.
    data = null;
  }
  if (!res.ok || !data || typeof data.access_token !== 'string') {
    const reason = data?.error_description ?? data?.error ?? `HTTP ${res.status}`;
    throw new AuthError(`Token exchange failed: ${String(reason)}`);
  }
  // Without a refresh token the session dies with the access token, and without
  // a numeric expires_in the saved expiry is NaN — refuse both up front.
  if (typeof data.refresh_token !== 'string' || !data.refresh_token || typeof data.expires_in !== 'number') {
    throw new AuthError('Token exchange failed: the auth server returned an incomplete token response.');
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    refresh_token_expires_in:
      typeof data.refresh_token_expires_in === 'number' ? data.refresh_token_expires_in : undefined,
  };
}

import type { AuthenticatedFetch } from '@picsart/ai-sdk';
import { AuthError } from '#infra/errors/auth.ts';
import { isNetworkError, NetworkError } from '#infra/errors/network.ts';
import { getOutput } from '#infra/ui-core/output.ts';
import { type Credentials, getEnvCredentials, refreshAccessToken } from '#services/auth.ts';
import { makeHeaders } from '#services/constants.ts';

/** Default timeout for authenticated fetch calls (120 seconds). */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Build an authenticated fetch that adds auth headers and retries on 401.
 * On 401, refreshes the token and retries once.
 * Every request gets a default 120s timeout via AbortSignal.timeout().
 */
export function createAuthenticatedFetch(getCreds: () => Credentials): AuthenticatedFetch {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const creds = getCreds();
    const headers: Record<string, string> = {
      ...makeHeaders(creds.token, creds.uid),
      ...((init?.headers as Record<string, string>) ?? {}),
    };

    const signal = init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const res = await fetch(url, { ...init, headers, signal });

    // A ReadableStream body is consumed by the first attempt and cannot be
    // replayed — retrying would throw. Hand the 401 back to the caller instead.
    const bodyIsReplayable = !(typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream);

    if (res.status === 401 && bodyIsReplayable) {
      // Release the discarded 401 response — an unconsumed body pins the
      // socket (undici keeps the connection out of the pool until GC).
      try {
        await res.body?.cancel();
      } catch {
        /* already consumed or closed — nothing to release */
      }
      // An env-provided token (CI mode) has no refresh token — refreshing the
      // disk credentials would rotate an identity this request isn't using.
      if (getEnvCredentials()) {
        throw new AuthError(
          'API rejected the token from PICSART_ACCESS_TOKEN (401). Provide a fresh token, or unset the env vars and run "gen-ai login".',
        );
      }
      getOutput().info('Session expired, refreshing token...');
      let refreshedCreds: Credentials;
      try {
        refreshedCreds = await refreshAccessToken();
      } catch (err) {
        // Don't blame the credentials for a failure that never reached the
        // auth server — a network-shaped error is a NetworkError (exit 4).
        if (isNetworkError(err)) {
          throw new NetworkError(`could not refresh the access token (${(err as Error).message})`);
        }
        // AuthError → exit code 3 + styled login hint, not GENERAL_ERROR (1).
        throw new AuthError('Token refresh failed. Run "gen-ai login" to re-authenticate.');
      }
      const refreshedAuth = makeHeaders(refreshedCreds.token, refreshedCreds.uid);
      const retryHeaders: Record<string, string> = {
        ...refreshedAuth,
        ...((init?.headers as Record<string, string>) ?? {}),
        // The refreshed identity must win on the retry — a caller-supplied
        // Authorization would re-send the very token that just earned the 401.
        Authorization: refreshedAuth.Authorization,
        'user-id': refreshedAuth['user-id'],
      };
      const retrySignal = init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
      return fetch(url, { ...init, headers: retryHeaders, signal: retrySignal });
    }

    return res;
  };
}

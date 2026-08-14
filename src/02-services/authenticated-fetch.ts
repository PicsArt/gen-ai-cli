import type { AuthenticatedFetch } from '@picsart/ai-sdk';
import { isNetworkError, NetworkError } from '#infra/errors/network.ts';
import { getOutput } from '#infra/ui-core/output.ts';
import { type Credentials, refreshAccessToken } from '#services/auth.ts';
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
        throw new Error('Token refresh failed. Run "gen-ai login" to re-authenticate.');
      }
      const retryHeaders: Record<string, string> = {
        ...makeHeaders(refreshedCreds.token, refreshedCreds.uid),
        ...((init?.headers as Record<string, string>) ?? {}),
      };
      const retrySignal = init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
      return fetch(url, { ...init, headers: retryHeaders, signal: retrySignal });
    }

    return res;
  };
}

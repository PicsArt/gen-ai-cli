/**
 * Shared SDK client factory for CLI commands.
 * Builds a createClient() instance with authenticated fetch and Drive enabled.
 */
import { catalog, createClient } from '@picsart/ai-sdk';
import { AuthError } from '#infra/errors/auth.ts';
import { createAuthenticatedFetch } from '#services/authenticated-fetch.ts';
import { getApiUrl } from '#services/constants.ts';
import { getToken, loadCredentials } from './auth.ts';

const CLI_DRIVE_FOLDER = 'Gen AI';

/**
 * Build an authenticated fetch + creds pair. The fetch callback re-reads
 * credentials from disk on each request so refreshed tokens are picked up.
 * Throws if credentials disappear mid-session instead of silently degrading.
 */
export async function getAuthenticatedFetch() {
  const creds = await getToken();
  const authenticatedFetch = createAuthenticatedFetch(() => {
    const fresh = loadCredentials();
    if (fresh) return fresh;
    throw new AuthError('Credentials lost during session. Run "gen-ai login" to re-authenticate.');
  });
  return { authenticatedFetch, creds };
}

let _client: ReturnType<typeof createClient> | null = null;

/**
 * Get the process-wide SDK client, building it on first use. Cached because
 * every drive.ts wrapper calls this — one command can hit it several times,
 * and each build re-runs getToken(). Safe to cache: the authenticated fetch
 * re-reads credentials from disk per request, so refreshed tokens are picked
 * up without a rebuild, and apiUrl is fixed for the process lifetime.
 * A failed build is not cached — the next call retries.
 */
export async function getAiClient() {
  if (_client) return _client;
  const { authenticatedFetch } = await getAuthenticatedFetch();
  _client = createClient({
    fetch: authenticatedFetch,
    apiUrl: getApiUrl(),
    drive: { folder: CLI_DRIVE_FOLDER },
  });
  return _client;
}

/** Test-only: drop the cached client (and pricing flag) between specs. */
export function resetAiClientCache(): void {
  _client = null;
  _pricingConfigured = false;
}

let _pricingConfigured = false;

/**
 * Register the pricing source with the SDK using the CLI's authenticated
 * fetch. Idempotent — safe to call from any command before reading prices.
 */
export async function ensurePricingClient(): Promise<void> {
  if (_pricingConfigured) return;
  const { authenticatedFetch } = await getAuthenticatedFetch();
  catalog.pricing.configure({
    baseUrl: getApiUrl(),
    fetch: (input, init) => authenticatedFetch(String(input), init),
  });
  _pricingConfigured = true;
}

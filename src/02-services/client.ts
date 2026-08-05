/**
 * Shared SDK client factory for CLI commands.
 * Builds a createClient() instance with authenticated fetch and Drive enabled.
 */
import { catalog, createClient } from '@picsart/ai-sdk';
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
    throw new Error('Credentials lost during session. Run "gen-ai login" to re-authenticate.');
  });
  return { authenticatedFetch, creds };
}

export async function getAiClient() {
  const { authenticatedFetch } = await getAuthenticatedFetch();
  return createClient({
    fetch: authenticatedFetch,
    apiUrl: getApiUrl(),
    drive: { folder: CLI_DRIVE_FOLDER },
  });
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

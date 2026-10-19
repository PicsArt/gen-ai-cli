/**
 * Credential shape + the storage/identity primitives shared by the auth flows.
 *
 * `Credentials`, `saveCredentials` and `fetchUserInfo` live here (not in
 * auth.ts) so the device-grant flow (device-auth.ts) can reuse them without
 * importing auth.ts — auth.ts routes device-sourced refreshes into
 * device-auth.ts, so a back-edge would create an import cycle. Credential
 * loading + per-environment namespacing stay in auth.ts.
 */
import * as fs from 'node:fs';
import { ensureDataDir } from '#infra/utils/data-dir.ts';
import { getApiUrl, getCredentialsPath } from '#services/constants.ts';

export interface Credentials {
  token: string;
  refreshToken: string;
  uid: string;
  email: string;
  expiresAt: string;
  refreshExpiresAt?: string;
  /**
   * API base URL these tokens were issued against. Stamped at login and carried
   * through refresh so a session can never be presented to — or refreshed
   * against — a different environment's auth server. Optional: files written by
   * older builds predate it and are trusted.
   */
  apiUrl?: string;
  /**
   * Which auth system issued these tokens, so refresh routes to the right
   * server. Absent on credentials written before this field existed (and on
   * env credentials) — treated as the default mini-apps flow.
   */
  authSource?: 'device' | 'miniapps';
}

/** Timeout for the user-info call (and other short identity lookups). */
const USER_INFO_TIMEOUT_MS = 30_000;

/** Persist credentials to disk atomically (tmp + rename), mode 0o600. */
export function saveCredentials(creds: Credentials): void {
  ensureDataDir();
  const credPath = getCredentialsPath();
  // Atomic tmp + rename (same pattern as user-config/history/device-id): a
  // crash mid-write must not corrupt credentials and silently log the user out.
  const tmp = `${credPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, credPath);
}

export async function fetchUserInfo(accessToken: string): Promise<{ uid: string; email: string }> {
  const res = await fetch(`${getApiUrl()}/gw-v2/users/show/me.json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(USER_INFO_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Failed to fetch user info (${res.status})`);
  const data = (await res.json()) as Record<string, unknown>;
  const response = (data.response ?? data) as Record<string, unknown>;
  return {
    uid: String(response.id ?? ''),
    email: String(response.email ?? response.username ?? ''),
  };
}

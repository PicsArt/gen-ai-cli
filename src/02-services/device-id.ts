/**
 * Stable device identifier — generated once on first run, persisted to
 * ~/.gen-ai/device-id, and read on every subsequent invocation.
 *
 * Used for analytics. UUIDv4 (122 bits of entropy) — collision-safe across
 * any realistic install base, no PII, no timestamp leak.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDataDir, getDataDir } from '#infra/utils/data-dir.ts';

function getDeviceIdPath(): string {
  return path.join(getDataDir(), 'device-id');
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns the device_id, generating and persisting it on first run. */
export function getDeviceId(): string {
  const file = getDeviceIdPath();
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (UUID_V4_RE.test(existing)) return existing;
  } catch {
    // file missing or unreadable — fall through and regenerate
  }

  const id = crypto.randomUUID();
  ensureDataDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, id, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return id;
}

/**
 * UUIDv7 generator — time-ordered identifier (RFC 9562).
 *
 * Layout: 48 bits unix-ms timestamp | 4 bits version (7) | 12 bits random
 *         | 2 bits variant (10) | 62 bits random.
 *
 * Used for analytics session_id — sortable by creation time, useful for
 * range scans on the analytics backend.
 */
import * as crypto from 'node:crypto';

export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const ms = Date.now();
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms >>> 24) & 0xff;
  bytes[3] = (ms >>> 16) & 0xff;
  bytes[4] = (ms >>> 8) & 0xff;
  bytes[5] = ms & 0xff;

  // version 7 in high nibble of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // RFC 4122 variant (10xx) in high bits of byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let cachedSessionId: string | undefined;

/** Returns the session_id for the current process. Generated once, cached. */
export function getSessionId(): string {
  if (!cachedSessionId) cachedSessionId = uuidv7();
  return cachedSessionId;
}

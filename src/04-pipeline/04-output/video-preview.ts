/**
 * CLI video preview thumbnail — extracts first frame via ffmpeg and uploads to CDN.
 * Non-blocking: silently returns undefined if ffmpeg is unavailable or extraction fails.
 */
import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import * as fs from 'node:fs';
import { isIP } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { uploadFile } from '#services/file-upload.ts';

let ffmpegChecked = false;
let ffmpegAvailable = false;

/**
 * Block SSRF: only allow https URLs pointing to public hosts.
 *
 * The private-range prefixes are applied ONLY when the host is an actual
 * IP literal — plain startsWith on a hostname would blocklist real domains
 * like `fcbarcelona.com` (fc00::/7 prefix) or `10.media.example.com`.
 * Exported for testing.
 */
export function isSafeUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;

  // Strip brackets from IPv6 addresses — URL.hostname returns e.g. "[::ffff:7f00:1]"
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost') return false;

  const ipVersion = isIP(host);
  if (ipVersion === 0) return true; // regular hostname — resolved check is isSafeUrlResolved's job

  return !isPrivateAddress(host, ipVersion);
}

/** Same range checks for literal-IP hosts and DNS-resolved addresses. */
function isPrivateAddress(host: string, ipVersion: number): boolean {
  if (ipVersion === 4) {
    return (
      host === '0.0.0.0' ||
      host.startsWith('0.') ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
    );
  }

  // IPv6: loopback, link-local, unique-local, IPv4-mapped
  return (
    host === '::1' ||
    host.startsWith('fe80') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('::ffff:')
  );
}

/**
 * isSafeUrl + DNS resolution: a lexically-clean hostname can still resolve
 * to a private or loopback address (attacker-controlled DNS), so every
 * resolved address must pass the same range checks as literal IPs.
 * Resolution failure counts as unsafe — the preview is best-effort anyway.
 *
 * This narrows but cannot fully close the rebinding TOCTOU: ffmpeg
 * re-resolves the hostname itself, so a DNS answer that flips between our
 * check and ffmpeg's fetch still gets through. Pinning the vetted IP is not
 * practical with https + ffmpeg (certificate hostname validation).
 * Exported for testing.
 */
export async function isSafeUrlResolved(raw: string): Promise<boolean> {
  if (!isSafeUrl(raw)) return false;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host) !== 0) return true; // literal IP — already vetted above
  try {
    const addresses = await lookup(host, { all: true });
    if (!Array.isArray(addresses) || addresses.length === 0) return false;
    return addresses.every((a) => {
      const addr = a.address.toLowerCase();
      const v = isIP(addr);
      return v !== 0 && !isPrivateAddress(addr, v);
    });
  } catch {
    return false;
  }
}

function hasFfmpeg(): boolean {
  if (ffmpegChecked) return ffmpegAvailable;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  ffmpegChecked = true;
  return ffmpegAvailable;
}

interface UploadOpts {
  token: string;
  uid: string;
  uploadUrl: string;
}

/**
 * Extract the first frame of a video URL and upload it as a JPEG thumbnail.
 * Returns the CDN URL or undefined on failure.
 */
export async function captureVideoPreview(videoUrl: string, opts: UploadOpts): Promise<string | undefined> {
  if (!hasFfmpeg()) return undefined;
  if (!(await isSafeUrlResolved(videoUrl))) return undefined;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-preview-'));
  const tmpFrame = path.join(tmpDir, 'frame.jpg');

  try {
    // ffmpeg reads remote URLs directly — args passed as array to avoid shell injection
    execFileSync('ffmpeg', ['-i', videoUrl, '-vframes', '1', '-q:v', '2', tmpFrame, '-y'], {
      stdio: 'ignore',
      timeout: 30_000,
    });

    if (!fs.existsSync(tmpFrame)) return undefined;

    return await uploadFile(tmpFrame, opts);
  } catch {
    return undefined;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  }
}

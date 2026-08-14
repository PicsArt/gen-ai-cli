/**
 * Spec for output/video-preview.
 *
 * `captureVideoPreview` does network + subprocess work. The "happy path"
 * needs ffmpeg installed on the machine, so we focus on the
 * security/validation paths that are testable everywhere:
 *
 *   - Rejects non-https URLs (returns undefined)
 *   - Rejects private / loopback / link-local hostnames (SSRF guard)
 *   - Returns undefined on any internal failure (never throws)
 */
import { describe, expect, it } from 'vitest';
import { captureVideoPreview, isSafeUrl } from './video-preview.ts';

const opts = { token: 't', uid: 'u', uploadUrl: 'https://upload.example.com' };

describe('captureVideoPreview — URL validation', () => {
  it('rejects http:// URLs', async () => {
    expect(await captureVideoPreview('http://example.com/v.mp4', opts)).toBeUndefined();
  });

  it('rejects malformed URLs', async () => {
    expect(await captureVideoPreview('not-a-url', opts)).toBeUndefined();
    expect(await captureVideoPreview('', opts)).toBeUndefined();
  });

  it('rejects localhost / loopback', async () => {
    expect(await captureVideoPreview('https://localhost/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://127.0.0.1/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://[::1]/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://0.0.0.0/v.mp4', opts)).toBeUndefined();
  });

  it('rejects RFC1918 private ranges', async () => {
    expect(await captureVideoPreview('https://10.0.0.1/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://192.168.1.1/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://172.16.0.1/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://172.20.5.5/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://172.31.255.255/v.mp4', opts)).toBeUndefined();
  });

  it('rejects link-local 169.254.* + IPv6 fe80::', async () => {
    expect(await captureVideoPreview('https://169.254.169.254/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://[fe80::1]/v.mp4', opts)).toBeUndefined();
  });

  it('rejects IPv6 unique-local (fc00::/7 — fc/fd prefix)', async () => {
    expect(await captureVideoPreview('https://[fc00::1]/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://[fd12::1]/v.mp4', opts)).toBeUndefined();
  });

  it('rejects IPv4-mapped IPv6 (::ffff:...)', async () => {
    expect(await captureVideoPreview('https://[::ffff:127.0.0.1]/v.mp4', opts)).toBeUndefined();
  });

  it('rejects shared-address range 100.64.0.0/10', async () => {
    expect(await captureVideoPreview('https://100.64.0.1/v.mp4', opts)).toBeUndefined();
    expect(await captureVideoPreview('https://100.127.255.255/v.mp4', opts)).toBeUndefined();
  });
});

describe('isSafeUrl — IP checks must not string-match real domain names', () => {
  // Regression: the private-range checks used plain startsWith on the
  // hostname, so any DOMAIN beginning with "fc", "fd", "fe80", "0.", "10."
  // etc. was silently blocked and video thumbnails never generated.
  it('allows public domains that merely start with an IP-like prefix', () => {
    expect(isSafeUrl('https://fcbarcelona.com/v.mp4')).toBe(true);
    expect(isSafeUrl('https://fdn.example.com/v.mp4')).toBe(true);
    expect(isSafeUrl('https://fe80festival.com/v.mp4')).toBe(true);
    expect(isSafeUrl('https://0.cdn.example.com/v.mp4')).toBe(true);
    expect(isSafeUrl('https://10.media.example.com/v.mp4')).toBe(true);
    expect(isSafeUrl('https://192.168.example.com/v.mp4')).toBe(true);
  });

  it('still blocks the actual private/loopback IPs', () => {
    expect(isSafeUrl('https://127.0.0.1/v.mp4')).toBe(false);
    expect(isSafeUrl('https://10.0.0.1/v.mp4')).toBe(false);
    expect(isSafeUrl('https://192.168.1.1/v.mp4')).toBe(false);
    expect(isSafeUrl('https://[fc00::1]/v.mp4')).toBe(false);
    expect(isSafeUrl('https://[fd12::1]/v.mp4')).toBe(false);
    expect(isSafeUrl('https://[fe80::1]/v.mp4')).toBe(false);
    expect(isSafeUrl('https://localhost/v.mp4')).toBe(false);
  });
});

describe('captureVideoPreview — failure path', () => {
  it('never throws on a public-looking URL (returns undefined when ffmpeg absent or fetch fails)', async () => {
    // We don't assert it returns a URL — depends on whether ffmpeg is installed AND
    // whether the URL is reachable. We DO assert it never throws.
    await expect(captureVideoPreview('https://example.com/missing-video.mp4', opts)).resolves.not.toThrow();
  });
});

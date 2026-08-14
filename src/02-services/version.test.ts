/**
 * Spec for the shared version helpers.
 *
 * Contract:
 *   isValidVersion(text):
 *     - accepts major.minor.patch, with an optional -prerelease suffix
 *     - rejects HTML/error-page bodies, empty strings, and partial versions
 *   isNewer(latest, current):
 *     - numeric (not lexicographic) comparison per segment
 *     - prerelease suffixes are ignored
 */
import { describe, expect, it } from 'vitest';
import { isNewer, isValidVersion } from './version.ts';

describe('isValidVersion', () => {
  it.each(['1.0.0', '2.61.0', '10.20.30', '1.0.0-beta.1', '0.0.1-rc-2'])('accepts %s', (v) => {
    expect(isValidVersion(v)).toBe(true);
  });

  it.each([
    '',
    '1.0',
    'v1.0.0',
    'latest',
    '<!DOCTYPE html><html>captive portal</html>',
    '<html><body>404</body></html>',
    '1.0.0\n2.0.0',
    'one.two.three',
  ])('rejects %j', (v) => {
    expect(isValidVersion(v)).toBe(false);
  });
});

describe('isNewer', () => {
  it('compares each segment numerically, not lexicographically', () => {
    expect(isNewer('2.10.0', '2.9.0')).toBe(true);
    expect(isNewer('10.0.0', '9.0.0')).toBe(true);
    expect(isNewer('2.9.0', '2.10.0')).toBe(false);
  });

  it('returns false for equal versions', () => {
    expect(isNewer('1.2.3', '1.2.3')).toBe(false);
  });

  it('ignores prerelease suffixes', () => {
    expect(isNewer('1.2.4-beta.1', '1.2.3')).toBe(true);
    expect(isNewer('1.2.3-beta.1', '1.2.3')).toBe(false);
  });
});

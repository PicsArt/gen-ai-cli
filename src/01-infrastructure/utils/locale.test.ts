import { describe, expect, it } from 'vitest';
import { getLocaleInfo } from './locale.ts';

describe('getLocaleInfo', () => {
  const info = getLocaleInfo();

  it('returns a non-empty country code (ISO-3166 alpha-2 or "ZZ" fallback)', () => {
    expect(typeof info.countryCode).toBe('string');
    expect(info.countryCode.length).toBe(2);
    expect(info.countryCode).toMatch(/^[A-Z]{2}$/);
  });

  it('returns a non-empty IANA timezone', () => {
    expect(typeof info.timezone).toBe('string');
    expect(info.timezone.length).toBeGreaterThan(0);
  });

  it('returns a non-empty BCP-47 locale', () => {
    expect(typeof info.locale).toBe('string');
    expect(info.locale.length).toBeGreaterThan(0);
  });

  it('is cached — subsequent calls return the same object reference', () => {
    expect(getLocaleInfo()).toBe(info);
  });
});

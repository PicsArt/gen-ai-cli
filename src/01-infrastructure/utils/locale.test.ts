import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocaleInfo } from './locale.ts';

describe('country code env fallback', () => {
  const ENV_KEYS = ['LC_ALL', 'LANG', 'LANGUAGE'] as const;
  let savedEnv: Record<string, string | undefined>;

  function stubIntlWithoutRegion(): void {
    // Force fromIntl() to yield no region so the env path is exercised.
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ locale: 'en', timeZone: 'UTC' }),
    } as unknown as Intl.DateTimeFormat);
  }

  /** Import a fresh module instance (getLocaleInfo caches per module). */
  async function loadFresh(): Promise<typeof import('./locale.ts')> {
    vi.resetModules();
    return await import('./locale.ts');
  }

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(values)) {
      process.env[key] = value;
    }
  }

  it('falls back to LANG when LC_ALL is set but empty (POSIX precedence)', async () => {
    setEnv({ LC_ALL: '', LANG: 'fr_FR.UTF-8' });
    stubIntlWithoutRegion();
    const mod = await loadFresh();
    expect(mod.getLocaleInfo().countryCode).toBe('FR');
  });

  it('prefers a non-empty LC_ALL over LANG', async () => {
    setEnv({ LC_ALL: 'de_DE.UTF-8', LANG: 'fr_FR.UTF-8' });
    stubIntlWithoutRegion();
    const mod = await loadFresh();
    expect(mod.getLocaleInfo().countryCode).toBe('DE');
  });

  it('returns ZZ when no source provides a region', async () => {
    setEnv({ LC_ALL: '', LANG: '' });
    stubIntlWithoutRegion();
    const mod = await loadFresh();
    expect(mod.getLocaleInfo().countryCode).toBe('ZZ');
  });
});

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

/**
 * System locale detection for analytics.
 *
 * Returns ISO-3166 country code, IANA timezone, and BCP-47 locale.
 * Backend may override countryCode from request IP — this is a best-effort
 * client-side signal so events still carry useful context offline.
 */

function fromIntl(): string | undefined {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    // BCP-47: first subtag is language (lowercase). Region subtag is exactly
    // 2 uppercase letters and never appears at index 0.
    const region = locale
      .split('-')
      .slice(1)
      .find((p) => /^[A-Z]{2}$/.test(p));
    return region;
  } catch {
    return undefined;
  }
}

function fromEnv(): string | undefined {
  const lang = process.env.LC_ALL ?? process.env.LANG ?? process.env.LANGUAGE;
  if (!lang) return undefined;
  // e.g. "en_US.UTF-8" → "US"; "fr_FR" → "FR"
  const match = lang.match(/[_-]([A-Z]{2})(?:[._@]|$)/);
  return match?.[1];
}

function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function getLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  } catch {
    return 'en';
  }
}

export interface LocaleInfo {
  countryCode: string; // ISO-3166 alpha-2, "ZZ" if unknown
  timezone: string; // IANA, e.g. "Europe/Yerevan"
  locale: string; // BCP-47, e.g. "en-US"
}

let cached: LocaleInfo | undefined;

export function getLocaleInfo(): LocaleInfo {
  if (cached) return cached;
  cached = {
    countryCode: fromIntl() ?? fromEnv() ?? 'ZZ',
    timezone: getTimezone(),
    locale: getLocale(),
  };
  return cached;
}

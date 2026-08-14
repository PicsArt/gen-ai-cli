/**
 * Version helpers shared by the self-updater and the startup update check.
 * Single source of truth — a comparison or validation fix must land in both
 * update channels at once, never in only one.
 */

/** Loose semver: major.minor.patch with an optional -prerelease suffix. */
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * True when `text` looks like a released version. Guards version strings that
 * come off the wire: a captive portal or CDN error page can answer latest.txt
 * with 200 + HTML, which must not be compared as a version — or spliced into
 * a download URL by `gen-ai update --force`.
 */
export function isValidVersion(text: string): boolean {
  return VERSION_RE.test(text);
}

/** Compare two release versions numerically; prerelease suffixes are ignored. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split('-')[0].split('.').map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

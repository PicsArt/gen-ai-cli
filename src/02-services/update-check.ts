/**
 * Non-blocking update check — fires a background fetch on startup,
 * prints a notice after the command finishes if a newer version exists.
 * Checks npm registry. Caches result for 24 hours.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getColor } from '#infra/ui-core/color.ts';
import { isQuietMode } from '#infra/ui-core/output.ts';
import { ensureDataDir, getDataDir } from '#infra/utils/data-dir.ts';
import { getUserConfig } from '#services/user-config.ts';
import { detectInstallMode, isNewer, isRunningFromSource, performUpdate } from './self-update.ts';

// Write directly to stderr — printUpdateNotice runs after `await execute(...)`
// returns, but for built-in oclif paths (`--help`, `--version`, unknown
// command) no BaseCommand was instantiated, so OutputManager is uninitialised.
// getColor() self-initializes, so this still honors --no-color,
// GEN_AI_NO_COLOR, NO_COLOR, and TERM=dumb (raw chalk only honored NO_COLOR).
function emit(line: string): void {
  process.stderr.write(`${getColor().info('i')} ${line}\n`);
}

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@picsart/gen-ai/latest';
const BINARY_LATEST_URL = `${process.env.GEN_AI_BASE_URL ?? 'https://picsart.com/gen-ai-cli/releases'}/latest.txt`;
const CACHE_FILE = 'update-check.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3_000;
const NOTICE_TIMEOUT_MS = 500;

interface CacheData {
  lastCheck: string;
  latestVersion: string;
}

let _currentVersion = '';
let _checkPromise: Promise<string | null> | null = null;

function getCachePath(): string {
  return path.join(getDataDir(), CACHE_FILE);
}

function readCache(): CacheData | null {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf-8');
    const data = JSON.parse(raw) as CacheData;
    if (data.lastCheck && data.latestVersion) return data;
    return null;
  } catch {
    return null;
  }
}

function writeCache(latestVersion: string): void {
  try {
    ensureDataDir();
    fs.writeFileSync(
      getCachePath(),
      JSON.stringify(
        {
          lastCheck: new Date().toISOString(),
          latestVersion,
        },
        null,
        2,
      ),
    );
  } catch {
    // Silently ignore write failures
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  // Binary install checks CDN; npm install checks registry. Uses the same
  // detection as the updater itself — a divergent check here would compare
  // against a channel `gen-ai update` doesn't install from.
  const isBinary = detectInstallMode() === 'binary';
  try {
    if (isBinary) {
      const res = await fetch(BINARY_LATEST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      return (await res.text()).trim() || null;
    }
    const res = await fetch(NPM_REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Fire a background version check. Call at the start of main(), before
 * running the command. Does NOT block — stores a Promise internally.
 */
export function startUpdateCheck(currentVersion: string): void {
  _currentVersion = currentVersion;

  const cached = readCache();
  if (cached) {
    const age = Date.now() - new Date(cached.lastCheck).getTime();
    if (age < CACHE_TTL_MS) {
      _checkPromise = Promise.resolve(cached.latestVersion);
      return;
    }
  }

  // Write the cache as soon as the fetch resolves so quick one-shot commands
  // (which hit the printUpdateNotice timeout before the fetch returns) still
  // populate the cache for the next invocation.
  _checkPromise = fetchLatestVersion()
    .then((latest) => {
      if (latest) writeCache(latest);
      return latest;
    })
    .catch(() => null);
}

/**
 * Check if a newer version is available (non-blocking, uses cache).
 * Returns the latest version string if newer, or null.
 */
export function getAvailableUpdate(): string | null {
  const cached = readCache();
  if (!cached) return null;
  return isNewer(cached.latestVersion, _currentVersion) ? cached.latestVersion : null;
}

/**
 * Print an update notice if a newer version is available. Call after the
 * command handler finishes (one-shot) or before the REPL loop (interactive).
 *
 * Auto-update is OPT-IN per call site, not just per user config. Only the
 * REPL-start path passes `allowAutoUpdate: true` because that's the only safe
 * point to replace the running binary or shell out to `npm install`:
 *   - the user is opening the tool, willing to wait briefly
 *   - no command output to corrupt, no piped consumer waiting for stdout
 *   - the running process keeps its old in-memory binary; the new version is
 *     picked up on the NEXT REPL launch, so mid-process binary replacement
 *     can't affect post-flight work
 * One-shot invocations only print the notice — they never auto-update,
 * even when `config.autoUpdate` is true.
 */
export async function printUpdateNotice(opts?: { allowAutoUpdate?: boolean }): Promise<void> {
  if (!_checkPromise) return;
  // Honor --quiet: the notice is non-essential output.
  if (isQuietMode()) return;

  // Clear the race timer once settled — a dangling timeout holds the event
  // loop open and delays natural process exit by up to NOTICE_TIMEOUT_MS.
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  const latest = await Promise.race([
    _checkPromise,
    new Promise<null>((resolve) => {
      timerHandle = setTimeout(() => resolve(null), NOTICE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timerHandle));

  if (!latest) return;

  // Cache write happens in the background fetch chain; no need to repeat here.

  if (!isNewer(latest, _currentVersion)) return;

  const config = getUserConfig();
  const color = getColor();
  // Dev clone: never attempt a global `npm install -g` — there's no global
  // install to upgrade. Just emit the notice; the user can pull / rebuild.
  const canAutoUpdate = opts?.allowAutoUpdate && config.autoUpdate && !isRunningFromSource();
  if (canAutoUpdate) {
    emit(`Auto-updating: ${color.dim(_currentVersion)} \u2192 ${color.success(latest)}`);
    const result = await performUpdate({ currentVersion: _currentVersion });
    if (result.updated) {
      emit(color.success(`\u2713 ${result.message}. Restart your terminal to use the new version.`));
    } else {
      emit(color.warning(`Auto-update failed: ${result.message}`));
    }
    return;
  }

  const hint = isRunningFromSource()
    ? color.dim('(dev clone — pull and rebuild to update)')
    : `  Run: ${color.info('gen-ai update')}`;
  emit(`Update available: ${color.dim(_currentVersion)} \u2192 ${color.success(latest)}${hint ? `  ${hint}` : ''}`);
}

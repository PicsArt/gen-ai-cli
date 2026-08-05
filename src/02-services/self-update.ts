/**
 * Self-update service — detects install mode (compiled binary / npm)
 * and routes to the matching updater.
 */
import { execFileSync, spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLI_VERSION } from '#services/constants.ts';

export interface UpdateResult {
  updated: boolean;
  oldVersion: string;
  newVersion: string;
  message: string;
}

const BINARY_BASE_URL = process.env.GEN_AI_BASE_URL ?? 'https://picsart.com/gen-ai-cli/releases';
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@picsart/gen-ai/latest';

type InstallMode = 'binary' | 'npm';

function detectInstallMode(): InstallMode {
  // Bun-compiled standalone binaries (the S3-distributed `gen-ai` binary) expose
  // process.versions.bun. The npm-distributed package runs under plain Node, where
  // process.versions.bun is undefined. The legacy GEN_AI_OCLIF_ROOT signal is
  // preserved as a fallback for future install modes that pass it explicitly.
  if (process.versions.bun) return 'binary';
  if (process.env.GEN_AI_OCLIF_ROOT) return 'binary';
  return 'npm';
}

/**
 * True when the running source is a dev clone, not a globally-installed
 * package or a packaged binary. Used to suppress the auto-update path —
 * a `npm install -g` against an unrelated source tree is always wrong.
 *
 * Heuristic: this module file is inside `node_modules` ⇒ installed.
 * Bun-compiled binaries also count as "installed" (they cannot run an
 * `npm install`, but they reach the binary updater happily).
 */
export function isRunningFromSource(): boolean {
  if (process.versions.bun) return false;
  return !import.meta.url.includes('/node_modules/');
}

/**
 * True on musl-libc Linux (Alpine et al.). We ship separate glibc and musl
 * binaries, so the self-updater must pick the right one — otherwise a `gen-ai
 * update` on Alpine replaces the running musl binary with an incompatible glibc
 * build. Mirrors the detection in install/install.sh (ldd, then the musl loader).
 */
function isMuslLinux(): boolean {
  if (os.platform() !== 'linux') return false;
  try {
    const out = execFileSync('ldd', ['--version'], { encoding: 'utf8' });
    if (/musl/i.test(out)) return true;
  } catch (err: unknown) {
    // ldd prints its banner to stderr and often exits non-zero — inspect it too.
    const stderr = (err as { stderr?: Buffer | string })?.stderr?.toString() ?? '';
    if (/musl/i.test(stderr)) return true;
  }
  return fs.existsSync('/lib/ld-musl-x86_64.so.1') || fs.existsSync('/lib/ld-musl-aarch64.so.1');
}

function detectPlatform(): string | null {
  const arch = os.arch();
  const platform = os.platform();
  const archKey = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  if (!archKey) return null;
  if (platform === 'darwin') return `darwin-${archKey}`;
  if (platform === 'linux') return `linux-${archKey}${isMuslLinux() ? '-musl' : ''}`;
  if (platform === 'win32' && archKey === 'x64') return 'windows-x64';
  return null;
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split('-')[0].split('.').map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/* ── Binary install updater ──────────────────────────────────── */

async function fetchText(url: string, timeoutMs = 5_000): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function sha256(file: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

/**
 * Pick the sha256 for exactly one platform out of a checksums.txt body.
 *
 * Must be an exact end-of-line match, NOT a substring test: the label
 * "gen-ai-linux-x64" is a prefix of "gen-ai-linux-x64-musl", so `includes()`
 * would let a glibc lookup match the musl line (and vice-versa). Lines are
 * "<sha256>  gen-ai-<platform>[.exe]".
 */
export function findChecksum(checksumsText: string, platform: string, ext = ''): string | undefined {
  const wanted = `gen-ai-${platform}${ext}`;
  const line = checksumsText.split('\n').find((l) => l.trim().endsWith(wanted));
  return line?.trim().split(/\s+/)[0];
}

async function performBinaryUpdate(currentVersion: string, force: boolean): Promise<UpdateResult> {
  const latestText = await fetchText(`${BINARY_BASE_URL}/latest.txt`);
  const latestVersion = latestText?.trim();
  if (!latestVersion) {
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: currentVersion,
      message: 'Could not reach release server. Check your network connection.',
    };
  }

  if (!force && !isNewer(latestVersion, currentVersion)) {
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: latestVersion,
      message: `Already up to date (v${currentVersion}).`,
    };
  }

  const platform = detectPlatform();
  if (!platform) {
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: latestVersion,
      message: `Unsupported platform: ${os.platform()}-${os.arch()}. Download manually from ${BINARY_BASE_URL}/`,
    };
  }

  const ext = platform.startsWith('windows-') ? '.exe' : '';
  const binUrl = `${BINARY_BASE_URL}/${latestVersion}/${platform}/gen-ai${ext}`;
  // Stage next to the running binary so the final rename stays on the same
  // filesystem (avoids EXDEV) and we fail fast on permission issues.
  const newPath = `${process.execPath}.new`;
  if (fs.existsSync(newPath)) fs.unlinkSync(newPath);

  try {
    const res = await fetch(binUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    fs.writeFileSync(newPath, buf);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: latestVersion,
      message: `Download failed from ${binUrl}: ${msg}`,
    };
  }

  const checksumsText = await fetchText(`${BINARY_BASE_URL}/${latestVersion}/checksums.txt`);
  const expected = checksumsText ? findChecksum(checksumsText, platform, ext) : undefined;
  if (!expected) {
    fs.unlinkSync(newPath);
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: latestVersion,
      message: `Could not find checksum for ${platform} in checksums.txt`,
    };
  }

  const actual = sha256(newPath);
  if (actual !== expected) {
    fs.unlinkSync(newPath);
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: latestVersion,
      message: `Checksum mismatch. Expected ${expected}, got ${actual}.`,
    };
  }

  fs.chmodSync(newPath, 0o755);

  try {
    if (process.platform === 'win32') {
      scheduleWindowsSwap(newPath);
    } else {
      fs.renameSync(newPath, process.execPath);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: latestVersion,
      message: `Could not replace binary at ${process.execPath}: ${msg}. Check write permissions.`,
    };
  }

  const restartHint =
    process.platform === 'win32'
      ? 'Exit gen-ai; the swap runs automatically and the next launch is the new version.'
      : 'Restart to use the new version.';
  return {
    updated: true,
    oldVersion: currentVersion,
    newVersion: latestVersion,
    message: `Updated ${currentVersion} \u2192 ${latestVersion}. ${restartHint}`,
  };
}

/**
 * Windows file-locks the running .exe — direct overwrite or in-place rename
 * is unreliable (fails under AV, non-NTFS, older Win10). Stage the new
 * binary as a sibling .new, then spawn a detached cmd script that polls
 * until our PID exits, swaps in the new file, and self-deletes.
 */
function scheduleWindowsSwap(newPath: string): void {
  // Caller has already staged the signed binary at `${process.execPath}.new`.
  const swapScript = path.join(os.tmpdir(), `gen-ai-swap-${process.pid}-${Date.now()}.bat`);
  const body = [
    '@echo off',
    ':wait',
    `tasklist /FI "PID eq ${process.pid}" 2>NUL | find "${process.pid}" >NUL`,
    'if not errorlevel 1 ( timeout /t 1 /nobreak >NUL & goto wait )',
    `move /y "${newPath}" "${process.execPath}" >NUL`,
    'del "%~f0"',
    '',
  ].join('\r\n');
  fs.writeFileSync(swapScript, body);

  spawn('cmd.exe', ['/c', swapScript], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/* ── npm install updater ─────────────────────────────────────── */

async function fetchLatestFromNpm(): Promise<string | null> {
  const body = await fetchText(NPM_REGISTRY_URL);
  if (!body) return null;
  try {
    const data = JSON.parse(body) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function canWriteGlobalDir(): boolean {
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf-8' }).trim();
    fs.accessSync(prefix, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function getNpmInstalledVersion(): string | null {
  try {
    const output = execFileSync('npm', ['ls', '-g', '@picsart/gen-ai', '--json', '--depth=0'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    const data = JSON.parse(output) as { dependencies?: Record<string, { version?: string }> };
    return data.dependencies?.['@picsart/gen-ai']?.version ?? null;
  } catch {
    return null;
  }
}

async function performNpmUpdate(currentVersion: string, force: boolean): Promise<UpdateResult> {
  const latestVersion = await fetchLatestFromNpm();
  if (!latestVersion) {
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: currentVersion,
      message: 'Could not reach npm registry. Check your network connection.',
    };
  }

  if (!force && !isNewer(latestVersion, currentVersion)) {
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: latestVersion,
      message: `Already up to date (v${currentVersion}).`,
    };
  }

  if (!canWriteGlobalDir()) {
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: latestVersion,
      message: 'Permission denied. Try: sudo npm install -g @picsart/gen-ai@latest',
    };
  }

  try {
    execFileSync('npm', ['install', '-g', '@picsart/gen-ai@latest'], {
      stdio: 'inherit',
      timeout: 120_000,
    });
  } catch {
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: latestVersion,
      message: 'npm install failed. Try running: sudo npm install -g @picsart/gen-ai@latest',
    };
  }

  const installedVersion = getNpmInstalledVersion();
  if (installedVersion && !isNewer(installedVersion, currentVersion) && installedVersion !== latestVersion && !force) {
    return {
      updated: false,
      oldVersion: currentVersion,
      newVersion: installedVersion,
      message: `Install ran but version is still ${installedVersion}. Try: npm cache clean --force`,
    };
  }

  return {
    updated: true,
    oldVersion: currentVersion,
    newVersion: installedVersion ?? latestVersion,
    message: `Updated ${currentVersion} \u2192 ${installedVersion ?? latestVersion}`,
  };
}

/* ── Public entry point ──────────────────────────────────────── */

export async function performUpdate(opts?: { force?: boolean; currentVersion?: string }): Promise<UpdateResult> {
  const currentVersion = opts?.currentVersion ?? CLI_VERSION;
  const force = opts?.force ?? false;
  const mode = detectInstallMode();

  if (mode === 'binary') {
    return performBinaryUpdate(currentVersion, force);
  }

  return performNpmUpdate(currentVersion, force);
}

/**
 * Exit-code contract, exercised against the SHIPPED entry point.
 *
 * This deliberately runs `dist/bin/gen-ai.mjs` (built from src/bundle-entry.ts)
 * rather than `bin/dev.mjs` (src/index.ts). The two entries drifted once — only
 * the dev one initialized Pulse — and the shipped binary consequently exited 0
 * on EVERY error path, because `flushPulse()`'s awaited promise never settled
 * and Node reached the end of the event loop before `this.exit(code)` ran. A
 * harness pointed at the dev entry is structurally blind to that whole class of
 * bug, so these tests must use the real artifact.
 *
 * The build is cheap (~1s of tsup) and runs once per suite invocation. Set
 * GEN_AI_TEST_CLI to an already-built entry to skip it.
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = process.env.GEN_AI_TEST_CLI ?? join(REPO_ROOT, 'dist', 'bin', 'gen-ai.mjs');

if (!process.env.GEN_AI_TEST_CLI) {
  console.log('exit-codes: building dist/ (shipped entry) ...');
  execFileSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'pipe' });
}
assert.ok(fs.existsSync(CLI), `shipped CLI entry not found at ${CLI}`);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e: unknown) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${(e as Error).message}`);
  }
}

function runCli(
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
): { status: number; stdout: string; stderr: string } {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', ...extraEnv };
  for (const [k, v] of Object.entries(extraEnv)) if (v === undefined) delete env[k];
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      // Empty stdin: guarantees the non-TTY branch, so no command can block on
      // a prompt or fall into the interactive auto-login path.
      input: '',
      // Capture stderr instead of letting it inherit — keeps the suite's own
      // output readable when a dependency logs warnings.
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env as NodeJS.ProcessEnv,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/** A HOME with no credentials on disk, so auth resolution has nothing to use. */
function withEmptyHome(): {
  HOME: string;
  USERPROFILE: string;
  PICSART_ACCESS_TOKEN: undefined;
  PICSART_USER_ID: undefined;
} {
  const home = fs.mkdtempSync(join(os.tmpdir(), 'gen-ai-exit-'));
  return { HOME: home, USERPROFILE: home, PICSART_ACCESS_TOKEN: undefined, PICSART_USER_ID: undefined };
}

/** A HOME whose access token is expired but whose refresh token still looks live. */
function withExpiredCreds(): ReturnType<typeof withEmptyHome> {
  const env = withEmptyHome();
  fs.mkdirSync(join(env.HOME, '.gen-ai'), { recursive: true });
  fs.writeFileSync(
    join(env.HOME, '.gen-ai', 'credentials.json'),
    JSON.stringify({
      token: 'expired-tok',
      refreshToken: 'rfr',
      uid: 'u1',
      email: 'a@b.c',
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  );
  return env;
}

/** A HOME whose access token is still live, so nothing needs refreshing. */
function withValidCreds(): ReturnType<typeof withEmptyHome> {
  const env = withEmptyHome();
  fs.mkdirSync(join(env.HOME, '.gen-ai'), { recursive: true });
  fs.writeFileSync(
    join(env.HOME, '.gen-ai', 'credentials.json'),
    JSON.stringify({
      token: 'live-tok',
      refreshToken: 'rfr',
      uid: 'u1',
      email: 'a@b.c',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  );
  return env;
}

function tmpFile(name: string, contents = 'x'): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'gen-ai-file-'));
  const p = join(dir, name);
  fs.writeFileSync(p, contents);
  return p;
}

console.log('exit-codes');

await test('--help exits 0', () => {
  const { status } = runCli(['--help']);
  assert.equal(status, 0);
});

await test('--version exits 0', () => {
  const { status } = runCli(['--version']);
  assert.equal(status, 0);
});

await test('unknown command exits non-zero', () => {
  const { status } = runCli(['nonexistent-command']);
  assert.notEqual(status, 0);
});

await test('invalid flag exits non-zero (usage error)', () => {
  const { status } = runCli(['credits', '--definitely-not-a-flag']);
  assert.notEqual(status, 0, 'an unknown flag must not report success');
  assert.equal(status, 2, `expected USAGE_ERROR (2), got ${status}`);
});

await test('auth failure exits 3 (AUTH_ERROR)', () => {
  const { status } = runCli(['upload', tmpFile('a.png')], withEmptyHome());
  assert.equal(status, 3, `expected AUTH_ERROR (3), got ${status}`);
});

await test('auth failure with --json emits a parseable error on stdout', () => {
  const { status, stdout } = runCli(['upload', tmpFile('a.png'), '--json'], withEmptyHome());
  assert.equal(status, 3, `expected AUTH_ERROR (3), got ${status}`);
  const line = stdout.trim().split('\n').pop() ?? '';
  const parsed = JSON.parse(line) as { error?: string; code?: number };
  assert.equal(parsed.code, 3);
  assert.ok(typeof parsed.error === 'string' && parsed.error.length > 0, 'expected an error message');
});

await test('network-shaped refresh failure exits 4 (NETWORK_ERROR), not 3', () => {
  const { status, stdout } = runCli(['upload', tmpFile('a.png'), '--json'], {
    ...withExpiredCreds(),
    // Unresolvable host — the refresh fetch fails at the transport layer, so
    // the CLI never learns whether the credentials are valid.
    GEN_AI_API_URL: 'https://unreachable.invalid',
  });
  assert.equal(status, 4, `expected NETWORK_ERROR (4), got ${status}`);
  const line = stdout.trim().split('\n').pop() ?? '';
  const parsed = JSON.parse(line) as { error?: string; code?: number };
  assert.equal(parsed.code, 4);
  assert.ok(
    !/Not authenticated/i.test(parsed.error ?? ''),
    'a network failure must not be reported as an auth failure',
  );
});

await test('batch upload whose every file failed on the network exits 4, not 1', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'gen-ai-batch-'));
  const a = join(dir, 'a.png');
  const b = join(dir, 'b.png');
  fs.writeFileSync(a, 'x');
  fs.writeFileSync(b, 'y');

  const { status, stdout } = runCli(['upload', a, b, '--json'], {
    ...withValidCreds(),
    // Unresolvable upload host: every per-file upload dies at the transport
    // layer, so the batch has one honest cause to report.
    GEN_AI_UPLOAD_URL: 'https://unreachable.invalid',
  });

  assert.equal(status, 4, `expected NETWORK_ERROR (4), got ${status}`);
  const payload = JSON.parse(stdout.trim().split('\n').pop() ?? '') as {
    ok?: boolean;
    files?: { error?: string }[];
  };
  assert.equal(payload.ok, false);
  assert.equal(payload.files?.length, 2);
  for (const f of payload.files ?? []) {
    assert.match(f.error ?? '', /fetch failed/, 'per-file message must still name the transport failure');
  }
});

await test('batch upload mixing a network failure with a bad path exits 1', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'gen-ai-batch-mixed-'));
  const a = join(dir, 'a.png');
  fs.writeFileSync(a, 'x');
  const missing = join(dir, 'nope.png');

  const { status } = runCli(['upload', a, missing, '--json'], {
    ...withValidCreds(),
    GEN_AI_UPLOAD_URL: 'https://unreachable.invalid',
  });

  assert.equal(status, 1, `expected GENERAL_ERROR (1) for mixed causes, got ${status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

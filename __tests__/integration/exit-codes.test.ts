import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', '..', 'bin', 'dev.mjs');

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

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

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

console.log('stdout-stderr');

await test('models --json outputs valid JSON to stdout', () => {
  const stdout = execFileSync('node', [CLI, 'models', '--json'], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const parsed = JSON.parse(stdout.trim());
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length > 0);
});

await test('--no-color produces no ANSI escapes', () => {
  const stdout = execFileSync('node', [CLI, 'models', '--no-color'], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.ok(!stdout.includes('\x1b['), 'stdout should have no ANSI escapes');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

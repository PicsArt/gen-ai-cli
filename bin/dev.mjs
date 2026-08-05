#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, '..', 'src', 'index.ts');

try {
  execFileSync(process.execPath, [
    '--experimental-strip-types',
    '--no-warnings',
    entry,
    ...process.argv.slice(2),
  ], { stdio: 'inherit', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
} catch (e) {
  process.exit(e.status ?? 1);
}

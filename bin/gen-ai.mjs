#!/usr/bin/env node

const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 22) {
  console.error(`gen-ai requires Node.js 22 or later. You have v${process.versions.node}.`);
  console.error('Download from https://nodejs.org/ or run: nvm install 22');
  process.exit(1);
}

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

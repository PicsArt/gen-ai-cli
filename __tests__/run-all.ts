import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Note: errors, color-manager, output-manager, fuzzy, badge/card/divider/key-value/table
// were migrated to co-located vitest tests under `src/01-infrastructure/`.
// Run them via `npx vitest run`.
const suites = [
  'unit/models.test.ts',
  'unit/types.test.ts',
  'unit/deps.test.ts',
  'unit/registry.test.ts',
  'unit/execution.test.ts',
  'unit/output-display.test.ts',
  'unit/output-handle.test.ts',
  'integration/exit-codes.test.ts',
  'integration/stdout-stderr.test.ts',
];

let failures = 0;

for (const suite of suites) {
  const file = join(__dirname, suite);
  console.log(`\n--- ${suite} ---`);
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', file], {
      stdio: 'inherit',
    });
  } catch {
    failures++;
  }
}

console.log(`\n=== ${failures === 0 ? 'ALL PASSED' : `${failures} SUITE(S) FAILED`} ===`);
if (failures > 0) process.exit(1);

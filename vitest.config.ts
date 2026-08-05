/**
 * Vitest config — scoped to the new architecture (tiers 01–05).
 *
 * The legacy `__tests__/run-all.ts` runner stays as-is while we migrate
 * tests. New tests sit co-located next to their implementation file
 * (`<name>.test.ts`).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/01-infrastructure/**/*.test.ts',
      'src/02-services/**/*.test.ts',
      'src/03-definitions/**/*.test.ts',
      'src/04-pipeline/**/*.test.ts',
      'src/05-shells/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
    /** Tolerate empty include patterns while we build modules incrementally. */
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/01-infrastructure/**/*.ts',
        'src/02-services/**/*.ts',
        'src/03-definitions/**/*.ts',
        'src/04-pipeline/**/*.ts',
        'src/05-shells/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/__test-utils__/**', '**/__fixtures__/**', '**/index.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});

/**
 * Vitest config — scoped to the new architecture (tiers 01–05).
 *
 * The legacy `__tests__/run-all.ts` runner stays as-is while we migrate
 * tests. New tests sit co-located next to their implementation file
 * (`<name>.test.ts`).
 */
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Exercises the boot that installs a catalog, and the SDK allows one catalog
 * source per process — so it runs without the snapshot the other suites get.
 */
const CATALOG_BOOT_TEST = 'src/02-services/sdk-catalog.test.ts';

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'src/*.test.ts',
            'src/01-infrastructure/**/*.test.ts',
            'src/02-services/**/*.test.ts',
            'src/03-definitions/**/*.test.ts',
            'src/04-pipeline/**/*.test.ts',
            'src/05-shells/**/*.test.ts',
          ],
          exclude: [...configDefaults.exclude, CATALOG_BOOT_TEST],
          /** @picsart/ai-sdk 7 ships no catalog: install the checked-in snapshot. */
          setupFiles: ['test-fixtures/install-catalog.ts'],
        },
      },
      { extends: true, test: { name: 'catalog-boot', include: [CATALOG_BOOT_TEST] } },
    ],
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

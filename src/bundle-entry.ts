/**
 * Bundle entry point — compiled by tsup into a single minified JS file.
 *
 * Exports COMMANDS for oclif explicit strategy (command discovery).
 * Exports main() for the bin script to call.
 */
import { execute } from '@oclif/core';
import { createColorManager } from './01-infrastructure/ui-core/color.ts';
import { createOutputManager } from './01-infrastructure/ui-core/output.ts';
import { printUpdateNotice, startUpdateCheck } from './02-services/update-check.ts';
import { startRepl } from './05-shells/03-entry/repl.ts';

// Re-export commands manifest for oclif explicit discovery
export { COMMANDS } from './commands-manifest.ts';

/**
 * Read version from baked-in env var (compiled binary) or package.json.
 *
 * Resolution order:
 *   1. GEN_AI_VERSION env var — baked into Bun binaries by build-bin.sh.
 *   2. Workspace-root package.json (has `workspaces` field) — covers local dev,
 *      where package.json is hardcoded to 1.0.0 but the root is bumped
 *      on every semantic-release commit.
 *   3. Nearest package.json — covers the npm-published case where
 *      dist/package.json has the version written by publish-package.mjs.
 *
 * The walk-up stops at any `node_modules` boundary so an installed package
 * never picks up the consumer's workspace version.
 */
async function readVersion(): Promise<string> {
  const baked = process.env.GEN_AI_VERSION;
  if (baked && baked !== '0.0.0') return baked;
  try {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    let dir = dirname(fileURLToPath(import.meta.url));
    let nearestVersion: string | undefined;
    for (let i = 0; i < 6; i++) {
      if (dir.endsWith(`${'/'}node_modules`) || dir.endsWith(`\\node_modules`)) break;
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        if (pkg.workspaces) return pkg.version ?? '0.0.0';
        if (!nearestVersion && pkg.version) nearestVersion = pkg.version;
      } catch {
        /* no package.json at this level — keep walking */
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return nearestVersion ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Main CLI entry — called by the bin script.
 * Starts REPL when no args, otherwise delegates to oclif.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const version = await readVersion();

  // Fire the background version check before doing any work so it has a chance
  // to complete during command execution. Both REPL and one-shot paths consume
  // the result via printUpdateNotice() — REPL on start (auto-update allowed),
  // one-shot after execute() (notice only, never auto-updates).
  startUpdateCheck(version);

  if (args.length === 0 && process.stdin.isTTY) {
    const color = createColorManager({ enabled: 'auto' });
    createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });

    await startRepl(version);
  } else {
    await execute({ dir: process.env.GEN_AI_OCLIF_ROOT ?? import.meta.url });
    await printUpdateNotice();
  }
}

import { execute } from '@oclif/core';
import { CLI_VERSION } from '#services/constants.ts';
import { runWithPulse } from './02-services/pulse.ts';
import { printUpdateNotice, startUpdateCheck } from './02-services/update-check.ts';

const args = process.argv.slice(2);

// In dev mode, CLI_VERSION is '0.0.0-dev'. Walk up looking for the workspace
// root package.json (bumped by semantic-release); fall back to the nearest
// package.json. Stop at any node_modules boundary so installed copies don't
// inherit the consumer's workspace version.
let version = CLI_VERSION;
if (version === '0.0.0-dev') {
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    let dir = dirname(fileURLToPath(import.meta.url));
    let nearestVersion: string | undefined;
    for (let i = 0; i < 6; i++) {
      if (dir.endsWith(`${'/'}node_modules`) || dir.endsWith(`\\node_modules`)) break;
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
          version?: string;
          workspaces?: unknown;
        };
        if (pkg.workspaces && pkg.version) {
          version = pkg.version;
          break;
        }
        if (!nearestVersion && pkg.version) nearestVersion = pkg.version;
      } catch {
        /* no package.json at this level — keep walking */
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (version === '0.0.0-dev' && nearestVersion) version = nearestVersion;
  } catch {
    /* use fallback */
  }
}

// Allow tests to override the version via env var so the update notice can be exercised.
if (process.env.GEN_AI_VERSION) version = process.env.GEN_AI_VERSION;

// Fire the background version check before doing any work so it has a chance
// to complete during command execution. Both REPL and one-shot paths consume
// the result via printUpdateNotice() — REPL on start (auto-update allowed),
// one-shot after execute() (notice only, never auto-updates).
startUpdateCheck(version);

// Wrap the entire CLI lifecycle in a Pulse AsyncLocalStorage context so any
// module can `import { pulse } from '@pulse/core'` and fire events. Respects
// PULSE_OPT_OUT=1 (calls become no-ops). pulse.flush() runs automatically in
// runWithPulse's finally block — no need to call it here.
await runWithPulse(version, async () => {
  if (args.length === 0 && process.stdin.isTTY) {
    const { createColorManager } = await import('./01-infrastructure/ui-core/color.ts');
    const { createOutputManager } = await import('./01-infrastructure/ui-core/output.ts');

    const color = createColorManager({ enabled: 'auto' });
    createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });

    const { startRepl } = await import('./05-shells/03-entry/repl.ts');
    await startRepl(version);
  } else {
    await execute({ dir: import.meta.url });
    await printUpdateNotice();
  }
});

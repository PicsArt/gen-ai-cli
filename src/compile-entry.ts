import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import { main } from './bundle-entry.ts';
import { COMMANDS } from './commands-manifest.ts';

// Bun's --compile embeds source into /$bunfs/root/ — oclif can't find
// package.json or dynamic-import the commands target from there. Bootstrap
// a real filesystem root in tmpdir with a pjson + shim module that re-exports
// the COMMANDS already bundled into the binary.
function setupOclifRoot(): string {
  const root = join(tmpdir(), `gen-ai-${pkg.version}`);
  mkdirSync(root, { recursive: true });

  const pjson = {
    ...pkg,
    oclif: {
      ...pkg.oclif,
      commands: {
        strategy: 'explicit',
        target: './commands.mjs',
        identifier: 'COMMANDS',
      },
    },
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify(pjson));
  writeFileSync(join(root, 'commands.mjs'), 'export const COMMANDS = globalThis.__GEN_AI_COMMANDS__;\n');

  return root;
}

(globalThis as { __GEN_AI_COMMANDS__?: typeof COMMANDS }).__GEN_AI_COMMANDS__ = COMMANDS;
process.env.GEN_AI_OCLIF_ROOT = pathToFileURL(join(setupOclifRoot(), 'package.json')).href;

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

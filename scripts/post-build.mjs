#!/usr/bin/env node
/**
 * Post-build step:
 * 1. Creates dist/bin/gen-ai.mjs — bin entry for the published package
 * 2. Copies package.json to dist/ and patches it for publishing
 * 3. Copies README.md so it ships in the npm tarball and is shown on the package page
 */
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// 1. Create bin entry point — imports main() from the bundle
mkdirSync('dist/bin', { recursive: true });
writeFileSync('dist/bin/gen-ai.mjs', `#!/usr/bin/env node
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 22) {
  console.error(\`gen-ai requires Node.js 22 or later. You have v\${process.versions.node}.\`);
  console.error('Download from https://nodejs.org/');
  process.exit(1);
}
import { main } from "../cli.js";
main().catch((err) => { console.error(err); process.exit(1); });
`, { mode: 0o755 });
console.log('Created dist/bin/gen-ai.mjs');

// 2. Copy and patch package.json for dist/
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
pkg.main = './cli.js';
pkg.bin = { 'gen-ai': './bin/gen-ai.mjs' };
pkg.files = ['*.js', 'bin/', 'skills/', 'README.md', 'banner.svg'];
pkg.oclif = {
  ...pkg.oclif,
  commands: {
    strategy: 'explicit',
    target: './cli.js',
    identifier: 'COMMANDS',
  },
};
// @picsart/semantic-release-config imports appendPostVersionConfig at config-load
// time, which reads dist/package.json and assigns scripts.postversion — so the
// scripts object must exist here or the whole release dies with a misleading
// "Cannot find module '@picsart/semantic-release-config'" (import-from-esm masks
// the real error). postversion itself is load-bearing: @semantic-release/npm runs
// `npm version` inside dist/ (pkgRoot: 'dist'), and the hook must carry the bump
// to the repo-root manifest for @semantic-release/git to commit. It must be set
// HERE, pointing at the version-only sync — if scripts.postversion is absent,
// appendPostVersionConfig injects `cp -r package.json ..`, which overwrites the
// root manifest with this stripped one (that is what broke main at v2.56.0).
pkg.scripts = { postversion: 'node ../scripts/sync-version-to-root.mjs' };
delete pkg.devDependencies;

// Drop private (GitLab-registry) packages from the published dependencies.
// tsup's `noExternal` (tsup.config.ts → bundledPrivateDeps) inlines their code
// into cli.js, so a consumer's `npm install -g @picsart/gen-ai` neither needs
// nor can resolve them — they're not on public npm, so leaving them here makes
// install fail with ETARGET/404. Any dep in a private scope is bundled by
// definition (tsup only externalizes the public packages), so strip by scope.
const PRIVATE_SCOPES = ['@picsart/', '@pulse/', '@pa/'];
if (pkg.dependencies) {
  for (const name of Object.keys(pkg.dependencies)) {
    if (PRIVATE_SCOPES.some((scope) => name.startsWith(scope))) {
      delete pkg.dependencies[name];
    }
  }
}

writeFileSync('dist/package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('Patched dist/package.json');

// 3. Copy banner.svg + README.md (with banner inlined as data URI so it
//    renders on npmjs.com — npm doesn't rewrite relative paths for non-GitHub
//    repos, and serves the README on its own origin)
copyFileSync('banner.svg', 'dist/banner.svg');

const svg = readFileSync('banner.svg', 'utf-8');
const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const readme = readFileSync('README.md', 'utf-8').replace(/\.\/banner\.svg/g, dataUri);
writeFileSync('dist/README.md', readme);
console.log('Copied banner.svg + inlined-banner README.md to dist/');

// 4. Ship the agent skills. `gen-ai install-skills` copies these to
//    ~/.claude/skills, so they must be in the tarball — without this step the
//    command installs nothing.
//
//    A skill is a directory with a SKILL.md at its root. That filter skips the
//    `.zip` siblings (landing-page downloads) and the `workflows/` folder,
//    which is a container of persona bundles distributed as zips, not a skill
//    itself — copying it whole would install one broken, manifest-less entry.
const SKILLS_SRC = 'install/skills';
const SKILLS_OUT = 'dist/skills';
rmSync(SKILLS_OUT, { recursive: true, force: true });
mkdirSync(SKILLS_OUT, { recursive: true });

const skillDirs = readdirSync(SKILLS_SRC, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_SRC, entry.name, 'SKILL.md')))
  .map((entry) => entry.name);

for (const skill of skillDirs) {
  cpSync(join(SKILLS_SRC, skill), join(SKILLS_OUT, skill), { recursive: true });
}

if (skillDirs.length === 0) {
  console.error(`No skills found in ${SKILLS_SRC}/ — install-skills would ship empty. Aborting.`);
  process.exit(1);
}
console.log(`Copied ${skillDirs.length} skills to dist/skills/: ${skillDirs.join(', ')}`);

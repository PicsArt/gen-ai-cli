#!/usr/bin/env node
/**
 * Post-build step:
 * 1. Creates dist/bin/gen-ai.mjs — bin entry for the published package
 * 2. Copies package.json to dist/ and patches it for publishing
 * 3. Copies README.md so it ships in the npm tarball and is shown on the package page
 */
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_REPO = 'PicsArt/gen-ai-cli';
const PUBLIC_REPO_URL = `https://github.com/${PUBLIC_REPO}`;
const BANNER_URL = `https://raw.githubusercontent.com/${PUBLIC_REPO}/main/banner.svg`;

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

pkg.repository = { type: 'git', url: `git+${PUBLIC_REPO_URL}.git` };
pkg.bugs = { url: `${PUBLIC_REPO_URL}/issues` };

writeFileSync('dist/package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`Patched dist/package.json (repository → ${PUBLIC_REPO})`);

// 3. Copy banner.svg + README.md, rewriting the banner to an absolute URL.
//
//    npm serves the README on its own origin, so the source's relative
//    ./banner.svg cannot resolve there — it needs an absolute https URL.
//    It must NOT be a `data:` URI: both npm and GitHub strip those from
//    <img src>, which is why the previously inlined banner rendered broken on
//    both surfaces. GitHub raw serves .svg as image/svg+xml, so it displays.
//
//    The GitHub README keeps the relative ./banner.svg (resolves in-repo);
//    only the npm copy in dist/ gets the absolute URL.
copyFileSync('banner.svg', 'dist/banner.svg');

const sourceReadme = readFileSync('README.md', 'utf-8');
if (!sourceReadme.includes('./banner.svg')) {
  console.error('error: README.md no longer references ./banner.svg — the npm banner rewrite would silently no-op.');
  console.error('       Keep the source reference relative; only dist/README.md gets the absolute URL.');
  process.exit(1);
}
writeFileSync('dist/README.md', sourceReadme.replaceAll('./banner.svg', BANNER_URL));
console.log('Copied banner.svg + README.md (absolute banner URL) to dist/');

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

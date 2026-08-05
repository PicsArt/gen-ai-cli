import { defineConfig } from 'tsup';

const nodeBuiltins = [
  'node:fs', 'node:path', 'node:os', 'node:http', 'node:https',
  'node:crypto', 'node:url', 'node:child_process', 'node:net',
  'node:readline', 'node:stream', 'node:process', 'node:events',
  'node:util', 'node:buffer', 'node:tty',
];

// Public npm packages left as runtime deps — installed by the consumer's `npm i`.
const externalDeps = [
  '@inquirer/checkbox', '@inquirer/confirm', '@inquirer/input',
  '@inquirer/search', '@inquirer/select',
  '@oclif/core', 'chalk', 'cli-progress', 'ora', 'fflate',
];

// Private (GitLab-registry) packages that are NOT publishable to public npm.
// tsup externalizes every dependency by default, so these MUST be listed in
// `noExternal` to actually inline their code into cli.js — otherwise the
// published package declares them as deps that a public `npm i` can't resolve
// (ETARGET/404). post-build.mjs strips them from dist/package.json deps to match.
const bundledPrivateDeps = ['@picsart/ai-sdk', '@pulse/core', '@pulse/server'];

export default defineConfig({
  entry: { cli: 'src/bundle-entry.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  outDir: 'dist',
  splitting: false,
  treeshake: true,
  minify: true,
  target: 'es2022',
  external: [...externalDeps, ...nodeBuiltins],
  noExternal: bundledPrivateDeps,
});

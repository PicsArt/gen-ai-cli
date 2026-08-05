import assert from 'node:assert';
import { createColorManager } from '../../src/01-infrastructure/ui-core/color.ts';
import { createOutputManager } from '../../src/01-infrastructure/ui-core/output.ts';
import { createCliDeps, toExecutionDeps, toOutputDeps } from '../../src/deps.ts';
import { resetCounters, summarize, test } from '../helpers.ts';

resetCounters();

function makeDeps() {
  const color = createColorManager({ enabled: false });
  const out = createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });
  return createCliDeps({
    color,
    out,
    config: {},
    flags: { quiet: false, debug: false, json: false, plain: false, noInput: false },
  });
}

await test('createCliDeps creates a valid CliDeps object', () => {
  const deps = makeDeps();
  assert.ok(deps.color);
  assert.ok(deps.out);
  assert.ok(deps.flags);
  assert.strictEqual(deps.flags.quiet, false);
});

await test('toExecutionDeps strips UI dependencies', () => {
  const execDeps = toExecutionDeps({
    apiUrl: 'https://api.picsart.com',
    uploadUrl: 'https://upload.picsart.com',
    authenticatedFetch: globalThis.fetch,
  });
  assert.strictEqual(execDeps.apiUrl, 'https://api.picsart.com');
  assert.strictEqual(execDeps.uploadUrl, 'https://upload.picsart.com');
  assert.strictEqual(typeof execDeps.authenticatedFetch, 'function');
  // Verify no UI properties leak through
  assert.strictEqual('color' in execDeps, false);
  assert.strictEqual('out' in execDeps, false);
});

await test('toOutputDeps includes UI but not resolver dependencies', () => {
  const deps = makeDeps();
  const outDeps = toOutputDeps(deps, {
    authenticatedFetch: globalThis.fetch,
    uploadUrl: 'https://upload.picsart.com',
  });
  assert.ok(outDeps.color);
  assert.ok(outDeps.out);
  assert.strictEqual(outDeps.uploadUrl, 'https://upload.picsart.com');
  assert.strictEqual(typeof outDeps.authenticatedFetch, 'function');
});

summarize('deps');

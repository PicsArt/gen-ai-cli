import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findModel, Models } from '@picsart/ai-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', '..', 'bin', 'dev.mjs');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e: unknown) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

function runCli(args: string[]): string {
  // Capture stdout. Some commands (e.g. models info) now write cards to stderr,
  // so we merge stderr into stdout for assertion convenience.
  const result = execFileSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result;
}

function runCliFull(args: string[]): string {
  const child = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return (child.stdout ?? '') + (child.stderr ?? '');
}

console.log('models');

await test('list returns all enabled models by default', () => {
  const output = runCli(['models']);
  const enabledCount = Models.list().filter((m) => !m.disabled).length;
  assert.ok(output.includes(`${enabledCount} models`), `Expected "${enabledCount} models" in output`);
});

await test('--mode video filters to video models', () => {
  const output = runCli(['models', '--mode', 'video']);
  const videoCount = Models.list().filter((m) => m.mode === 'video' && !m.disabled).length;
  assert.ok(output.includes(`${videoCount} models`), `Expected "${videoCount} models" in output`);
});

await test('--provider filters correctly', () => {
  const output = runCli(['models', '--provider', 'google']);
  assert.ok(output.toLowerCase().includes('google'), 'Output should include "google"');
  // Verify via JSON that all returned models have the expected provider
  const jsonOutput = runCli(['models', '--provider', 'google', '--json']);
  const filtered = JSON.parse(jsonOutput.trim()) as Array<{ provider: string }>;
  assert.ok(filtered.length > 0, 'Should have at least one google model');
  for (const m of filtered) {
    assert.equal(m.provider, 'google', `Expected provider "google" but got "${m.provider}"`);
  }
});

await test('--input-type i2v filters to i2v models', () => {
  const output = runCli(['models', '--input-type', 'i2v']);
  const i2vCount = Models.list().filter((m) => m.inputType === 'i2v' && !m.disabled).length;
  assert.ok(output.includes(`${i2vCount} models`), `Expected "${i2vCount} models" in output`);
});

await test('--disabled includes disabled models', () => {
  const output = runCli(['models', '--disabled']);
  const allCount = Models.list().length;
  assert.ok(output.includes(`${allCount} models`), `Expected "${allCount} models" in output`);
});

await test('--json outputs valid JSON', () => {
  const output = runCli(['models', '--json']);
  const data = JSON.parse(output.trim()) as Array<{ id: string; provider: string }>;
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);
  assert.ok(data[0].id);
  assert.ok(data[0].provider);
});

// Pick real catalog entries instead of hardcoding ids — hardcoded ids rot when
// the SDK catalog renames or retires a model (kling-v3-pro did exactly that).
const enabledModels = Models.list().filter((model) => !model.disabled);
const [infoModel, compareModel] = enabledModels;

await test('info shows correct model details', () => {
  const model = infoModel && findModel(infoModel.id);
  if (!model) {
    assert.fail('no enabled model found in catalog');
    return;
  }
  const output = runCliFull(['models', 'info', model.id]);
  assert.ok(output.includes(model.name), `Expected model name "${model.name}" in output`);
  assert.ok(output.includes(model.provider), `Expected provider "${model.provider}" in output`);
  assert.ok(output.includes(model.mode), `Expected mode "${model.mode}" in output`);
});

await test('info by display name works', () => {
  const model = Models.list().find((m) => !m.disabled);
  if (!model) {
    assert.fail('no enabled model found');
    return;
  }
  const output = runCliFull(['models', 'info', model.name]);
  assert.ok(output.includes(model.id), `Expected model id "${model.id}" in output`);
});

await test('info --json outputs valid JSON', () => {
  if (!infoModel) {
    assert.fail('no enabled model found in catalog');
    return;
  }
  const output = runCli(['models', 'info', infoModel.id, '--json']);
  const data = JSON.parse(output.trim()) as { id: string; schema: unknown };
  assert.equal(data.id, infoModel.id);
  assert.ok(data.schema);
});

await test('compare shows both models', () => {
  if (!infoModel || !compareModel) {
    assert.fail('need at least two enabled models in catalog');
    return;
  }
  const output = runCli(['models', 'compare', infoModel.id, compareModel.id]);
  assert.ok(output.includes(infoModel.id), `Output should include ${infoModel.id}`);
  assert.ok(output.includes(compareModel.id), `Output should include ${compareModel.id}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

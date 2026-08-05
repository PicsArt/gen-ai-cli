import assert from 'node:assert';
import type { ModelDefinition } from '@picsart/ai-sdk';
import { createColorManager } from '../../src/01-infrastructure/ui-core/color.ts';
import { createOutputManager } from '../../src/01-infrastructure/ui-core/output.ts';
import { handleOutput } from '../../src/04-pipeline/04-output/handle.ts';
import type { OutputDeps } from '../../src/deps.ts';
import type { ExecutionResult, OutputConfig } from '../../src/types.ts';
import { captureOutputAsync, resetCounters, summarize, test } from '../helpers.ts';

resetCounters();

function makeDeps(): OutputDeps {
  const color = createColorManager({ enabled: false });
  const out = createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });
  return { color, out, authenticatedFetch: globalThis.fetch, uploadUrl: 'https://upload.example.com' };
}

function makeConfig(overrides: Partial<OutputConfig> = {}): OutputConfig {
  return {
    driveSave: false,
    driveFolder: 'gen-ai-cli',
    open: false,
    clipboard: false,
    bell: false,
    notify: false,
    jsonMode: false,
    quietMode: false,
    plainMode: false,
    ...overrides,
  };
}

function makeResult(overrides = {}): ExecutionResult {
  return {
    status: 'completed' as const,
    url: 'https://cdn.example.com/result.png',
    results: [{ url: 'https://cdn.example.com/result.png', type: 'image' }],
    model: { id: 'test-model', name: 'Test Model', mode: 'image' } as unknown as ModelDefinition,
    params: { prompt: 'test prompt' },
    durationMs: 5000,
    ...overrides,
  };
}

await test('handleOutput displays result in rich mode', async () => {
  const deps = makeDeps();
  const config = makeConfig();
  const result = makeResult();
  const captured = await captureOutputAsync(async () => {
    await handleOutput(result, config, deps);
  });
  // Should have written something to stderr (the card) or stdout (success message)
  assert.ok(captured.stderr.length > 0 || captured.stdout.length > 0);
});

await test('handleOutput outputs JSON in json mode', async () => {
  const deps = makeDeps();
  const config = makeConfig({ jsonMode: true });
  const result = makeResult();
  const captured = await captureOutputAsync(async () => {
    await handleOutput(result, config, deps);
  });
  const parsed = JSON.parse(captured.stdout.trim());
  assert.strictEqual(parsed.url, 'https://cdn.example.com/result.png');
});

await test('handleOutput handles failed results', async () => {
  const deps = makeDeps();
  const config = makeConfig();
  const result = makeResult({ status: 'failed', error: 'API error', url: undefined, results: [] });
  const captured = await captureOutputAsync(async () => {
    await handleOutput(result, config, deps);
  });
  assert.ok(captured.stderr.includes('failed') || captured.stderr.includes('API error'));
});

summarize('output/handle');

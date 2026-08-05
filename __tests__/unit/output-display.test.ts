import assert from 'node:assert';
import type { ModelDefinition } from '@picsart/ai-sdk';
import { createColorManager } from '../../src/01-infrastructure/ui-core/color.ts';
import { createOutputManager } from '../../src/01-infrastructure/ui-core/output.ts';
import { displayResult } from '../../src/04-pipeline/04-output/display.ts';
import { captureOutputAsync, resetCounters, summarize, test } from '../helpers.ts';

resetCounters();

function makeDeps() {
  const color = createColorManager({ enabled: false });
  const out = createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });
  return { color, out, authenticatedFetch: globalThis.fetch, uploadUrl: 'https://upload.example.com' };
}

function makeResult(overrides = {}) {
  return {
    status: 'completed' as const,
    url: 'https://cdn.example.com/result.png',
    results: [{ url: 'https://cdn.example.com/result.png', type: 'image' }],
    model: { id: 'test-model', name: 'Test Model', mode: 'image' } as unknown as ModelDefinition,
    params: {},
    durationMs: 5000,
    ...overrides,
  };
}

await test('displayResult writes to stderr in rich mode', async () => {
  const deps = makeDeps();
  const result = makeResult();
  const captured = await captureOutputAsync(async () => {
    displayResult(result, { jsonMode: false, quietMode: false, plainMode: false }, deps);
  });
  assert.ok(captured.stderr.includes('Test Model') || captured.stderr.includes('result.png'));
});

await test('displayResult writes JSON to stdout in json mode', async () => {
  const deps = makeDeps();
  const result = makeResult();
  const captured = await captureOutputAsync(async () => {
    displayResult(result, { jsonMode: true, quietMode: false, plainMode: false }, deps);
  });
  const parsed = JSON.parse(captured.stdout.trim());
  assert.strictEqual(parsed.url, 'https://cdn.example.com/result.png');
});

await test('displayResult writes only URL in quiet mode', async () => {
  const color = createColorManager({ enabled: false });
  const out = createOutputManager({ color, quiet: true, debug: false, jsonMode: false, plainMode: false });
  const deps = { color, out, authenticatedFetch: globalThis.fetch, uploadUrl: 'https://upload.example.com' };
  const result = makeResult();
  const captured = await captureOutputAsync(async () => {
    displayResult(result, { jsonMode: false, quietMode: true, plainMode: false }, deps);
  });
  assert.ok(captured.stdout.includes('https://cdn.example.com/result.png'));
});

summarize('output/display');

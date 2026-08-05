import assert from 'node:assert';
import { resetCounters, summarize, test } from '../helpers.ts';

resetCounters();

await test('types module exports isInteractiveMode function', async () => {
  const { isInteractiveMode } = await import('../../src/types.ts');
  assert.strictEqual(typeof isInteractiveMode, 'function');
});

await test('isInteractiveMode returns false when silent is true', async () => {
  const { isInteractiveMode } = await import('../../src/types.ts');
  assert.strictEqual(isInteractiveMode({ silent: true, noInput: false }), false);
});

await test('isInteractiveMode returns false when noInput is true', async () => {
  const { isInteractiveMode } = await import('../../src/types.ts');
  assert.strictEqual(isInteractiveMode({ silent: false, noInput: true }), false);
});

summarize('types');

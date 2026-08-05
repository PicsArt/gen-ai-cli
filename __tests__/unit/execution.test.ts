import assert from 'node:assert';
import { resetCounters, summarize, test } from '../helpers.ts';

resetCounters();

await test('execute module exports the execute function', async () => {
  const mod = await import('../../src/04-pipeline/03-execution/execute.ts');
  assert.strictEqual(typeof mod.execute, 'function');
});

summarize('execution/execute');

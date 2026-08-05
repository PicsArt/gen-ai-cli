import assert from 'node:assert';
import { getOperationByCommand, getOperationById, OPERATIONS } from '../../src/05-shells/03-entry/menu-registry.ts';
import { resetCounters, summarize, test } from '../helpers.ts';

resetCounters();

await test('OPERATIONS contains all initial operations', () => {
  const ids = OPERATIONS.map((op) => op.id);
  assert.ok(ids.includes('generate'), 'missing generate');
  assert.ok(ids.includes('remove-bg'), 'missing remove-bg');
  assert.ok(ids.includes('enhance'), 'missing enhance');
  assert.ok(ids.includes('extend'), 'missing extend');
  assert.ok(ids.includes('change-bg'), 'missing change-bg');
  assert.ok(ids.includes('vectorize'), 'missing vectorize');
});

await test('every operation has id, label, description, and command', () => {
  for (const op of OPERATIONS) {
    assert.ok(op.id, `operation missing id`);
    assert.ok(op.label, `${op.id} missing label`);
    assert.ok(op.description, `${op.id} missing description`);
    assert.ok(op.command, `${op.id} missing command`);
  }
});

await test('no duplicate ids', () => {
  const ids = OPERATIONS.map((op) => op.id);
  const unique = new Set(ids);
  assert.strictEqual(ids.length, unique.size, `Duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
});

await test('no duplicate commands', () => {
  const cmds = OPERATIONS.map((op) => op.command);
  const unique = new Set(cmds);
  assert.strictEqual(cmds.length, unique.size, `Duplicate commands: ${cmds.filter((c, i) => cmds.indexOf(c) !== i)}`);
});

await test('getOperationById returns correct operation', () => {
  const op = getOperationById('generate');
  assert.ok(op);
  assert.strictEqual(op.id, 'generate');
  assert.strictEqual(op.command, 'generate');
});

await test('getOperationById returns undefined for unknown id', () => {
  const op = getOperationById('nonexistent');
  assert.strictEqual(op, undefined);
});

await test('getOperationByCommand returns correct operation', () => {
  const op = getOperationByCommand('remove-bg');
  assert.ok(op);
  assert.strictEqual(op.id, 'remove-bg');
});

summarize('registry');

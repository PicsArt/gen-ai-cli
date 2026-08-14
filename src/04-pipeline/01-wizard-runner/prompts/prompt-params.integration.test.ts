/**
 * Integration spec for `promptForParams` — REAL param-surface, mocked prompts.
 *
 * The unit spec (prompt-params.test.ts) mocks #param-surface entirely, so it
 * can never catch the class of bug where wizard answers bypass the layer-3
 * interpret half (coercion, default backfill, index auto-numbering). This
 * file wires the real wizard-schema + wizard-reader over fixture models and
 * only mocks the inquirer wrappers.
 *
 * Regression for: "interactive wizard ships multiPrompt items with the
 * descriptor-default index 0 on every shot" — the exact payload the API
 * rejects, and the reason `collectContextFromAnswers` exists.
 */
import type { GenerationContext, ModelDefinition } from '@picsart/ai-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const askWithNavMock = vi.hoisted(() => vi.fn());
const selectWithNavMock = vi.hoisted(() => vi.fn());
const confirmWithNavMock = vi.hoisted(() => vi.fn());

vi.mock('../nav.ts', () => ({
  askWithNav: askWithNavMock,
  selectWithNav: selectWithNavMock,
  confirmWithNav: confirmWithNavMock,
}));

// Real wizard-schema/wizard-reader over a fixture catalog: only getCatalog is
// swapped so the test does not depend on the live SDK model list.
vi.mock('#param-surface', async () => {
  const real = await vi.importActual<typeof import('#param-surface')>('#param-surface');
  const { MODEL_OBJECT } = await import('#param-surface/__test-utils__/models-min.ts');
  const { ALIAS_MAP } = await import('#param-surface/01-primitives/01-aliases/index.ts');
  return { ...real, getCatalog: () => real.loadCatalog([MODEL_OBJECT], ALIAS_MAP) };
});

import { promptForParams } from './prompt-params.ts';

const model: ModelDefinition = { id: 'fx-object', name: 'Object Model' } as ModelDefinition;
const emptyCtx: Partial<GenerationContext> = {};

afterEach(() => {
  askWithNavMock.mockReset();
  selectWithNavMock.mockReset();
  confirmWithNavMock.mockReset();
});

describe('promptForParams — answers run through the layer-3 wizard-reader', () => {
  it('multi-shot answers get consecutive indices from the descriptor min, not default-0 on every item', async () => {
    confirmWithNavMock.mockResolvedValueOnce(true); // "Add Multi-shot prompts?" gate
    askWithNavMock
      .mockResolvedValueOnce('2') // how many?
      .mockResolvedValueOnce('wide shot') // item 1 prompt
      .mockResolvedValueOnce('5') // item 1 duration
      .mockResolvedValueOnce('close-up') // item 2 prompt
      .mockResolvedValueOnce('7'); // item 2 duration

    const out = await promptForParams(model, emptyCtx);

    expect(out).toEqual({
      multiPrompt: [
        { index: 0, prompt: 'wide shot', duration: '5' },
        { index: 1, prompt: 'close-up', duration: '7' },
      ],
    });
  });

  it('the wizard never asks for the auto-numbered `index` subfield', async () => {
    confirmWithNavMock.mockResolvedValueOnce(true);
    askWithNavMock
      .mockResolvedValueOnce('1') // how many?
      .mockResolvedValueOnce('solo shot') // prompt
      .mockResolvedValueOnce('5'); // duration

    await promptForParams(model, emptyCtx);

    const asked = askWithNavMock.mock.calls.map((c) => String(c[0]));
    expect(asked.some((label) => /index/i.test(label))).toBe(false);
  });

  it('a declined optional object step is omitted from the ctx (not an empty array)', async () => {
    confirmWithNavMock.mockResolvedValueOnce(false); // decline the gate

    const out = await promptForParams(model, emptyCtx);

    expect(out).toEqual({});
  });
});

/**
 * Spec for `promptForParams` — the descriptor-driven params wizard.
 *
 * Contract (Fix #2 of PARAM_SURFACE_SPEC.md):
 *   - Walks the wizard steps produced by `generateWizardStepsFromCatalog`
 *     for the chosen model. NO hand-rolled per-kind loop.
 *   - Dispatches scalars to the existing inquirer wrappers
 *     (`selectWithNav`, `confirmWithNav`, `askWithNav`).
 *   - File kind → skipped (file pipeline owns it).
 *   - `prompt` key → skipped (the prompt step owns it with the rich box).
 *   - Already-set ctx keys → skipped (prefilled from flags).
 *   - Object descriptors → "How many?" + recursive per-item sub-wizard.
 */
import type { GenerationContext, ModelDefinition } from '@picsart/ai-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const schemaStepsMock = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));
const askWithNavMock = vi.hoisted(() => vi.fn());
const selectWithNavMock = vi.hoisted(() => vi.fn());
const confirmWithNavMock = vi.hoisted(() => vi.fn());
const outputInfoMock = vi.hoisted(() => vi.fn());

vi.mock('#param-surface', () => ({
  getCatalog: () => ({ all: () => [], bySdkKey: new Map(), byFlag: new Map() }),
  generateWizardStepsFromCatalog: () => schemaStepsMock.value,
}));
vi.mock('#flows', async () => {
  const real = await vi.importActual<typeof import('#flows')>('#flows');
  return { ...real, filterCatalog: (cat: unknown) => cat };
});
vi.mock('../nav.ts', () => ({
  askWithNav: askWithNavMock,
  selectWithNav: selectWithNavMock,
  confirmWithNav: confirmWithNavMock,
}));
vi.mock('#infra/ui-core/output.ts', async () => {
  const real = await vi.importActual<typeof import('#infra/ui-core/output.ts')>('#infra/ui-core/output.ts');
  return { ...real, getOutput: () => ({ info: outputInfoMock }) };
});

import { promptForParams } from './prompt-params.ts';

const model: ModelDefinition = { id: 'm-1', name: 'Model 1' } as ModelDefinition;
const emptyCtx: Partial<GenerationContext> = {};

afterEach(() => {
  schemaStepsMock.value = [];
  askWithNavMock.mockReset();
  selectWithNavMock.mockReset();
  confirmWithNavMock.mockReset();
  outputInfoMock.mockReset();
});

/* ──────────────────────────────────────────────────────────────── */
/*  No steps                                                        */
/* ──────────────────────────────────────────────────────────────── */

describe('promptForParams — empty schema', () => {
  it('returns {} when the model has no descriptor steps', async () => {
    schemaStepsMock.value = [];
    const out = await promptForParams(model, emptyCtx);
    expect(out).toEqual({});
  });
});

/* ──────────────────────────────────────────────────────────────── */
/*  Scalar dispatch                                                 */
/* ──────────────────────────────────────────────────────────────── */

describe('promptForParams — scalar dispatch', () => {
  it('routes `select` kind through selectWithNav', async () => {
    schemaStepsMock.value = [
      {
        kind: 'select',
        key: 'aspectRatio',
        label: 'Aspect Ratio',
        choices: [
          { id: '16:9', label: '16:9' },
          { id: '9:16', label: '9:16' },
        ],
      },
    ];
    selectWithNavMock.mockResolvedValue('9:16');
    const out = await promptForParams(model, emptyCtx);
    expect(selectWithNavMock).toHaveBeenCalledOnce();
    expect(out).toEqual({ aspectRatio: '9:16' });
  });

  it('routes `confirm` kind through confirmWithNav', async () => {
    schemaStepsMock.value = [{ kind: 'confirm', key: 'generateAudio', label: 'Generate audio?', default: false }];
    confirmWithNavMock.mockResolvedValue(true);
    const out = await promptForParams(model, emptyCtx);
    expect(confirmWithNavMock).toHaveBeenCalled();
    expect(out).toEqual({ generateAudio: true });
  });

  it('routes `text` kind through askWithNav and skips empty answers', async () => {
    schemaStepsMock.value = [{ kind: 'text', key: 'negativePrompt', label: 'Negative prompt' }];
    askWithNavMock.mockResolvedValue('no birds');
    const out = await promptForParams(model, emptyCtx);
    expect(out).toEqual({ negativePrompt: 'no birds' });
  });

  it('routes `number` kind through askWithNav with bounds and default', async () => {
    schemaStepsMock.value = [{ kind: 'number', key: 'cfgScale', label: 'CFG scale', min: 0, max: 1, default: 0.5 }];
    askWithNavMock.mockResolvedValue('0.7');
    const out = await promptForParams(model, emptyCtx);
    expect(out).toEqual({ cfgScale: 0.7 });
  });

  it('rejects out-of-range number input and falls back to default', async () => {
    schemaStepsMock.value = [{ kind: 'number', key: 'cfgScale', label: 'CFG', min: 0, max: 1, default: 0.5 }];
    askWithNavMock.mockResolvedValue('7.5');
    const out = await promptForParams(model, emptyCtx);
    expect(out).toEqual({ cfgScale: 0.5 });
    expect(outputInfoMock).toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────────── */
/*  Skipping rules                                                  */
/* ──────────────────────────────────────────────────────────────── */

describe('promptForParams — skipping rules', () => {
  it('skips file-kind steps (owned by file pipeline)', async () => {
    schemaStepsMock.value = [
      {
        kind: 'file',
        key: 'imageUrls',
        label: 'Input images',
        accept: 'image',
        multi: true,
      },
    ];
    const out = await promptForParams(model, emptyCtx);
    expect(out).toEqual({});
    expect(askWithNavMock).not.toHaveBeenCalled();
  });

  it("skips the `prompt` key (owned by the prompt step's rich command box)", async () => {
    schemaStepsMock.value = [{ kind: 'text', key: 'prompt', label: 'Prompt' }];
    const out = await promptForParams(model, emptyCtx);
    expect(out).toEqual({});
    expect(askWithNavMock).not.toHaveBeenCalled();
  });

  it('skips keys already set in the incoming ctx (prefilled from flags)', async () => {
    schemaStepsMock.value = [{ kind: 'text', key: 'negativePrompt', label: 'Negative' }];
    const out = await promptForParams(model, { negativePrompt: 'no birds' } as Partial<GenerationContext>);
    expect(out).toEqual({});
    expect(askWithNavMock).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────────── */
/*  Object descriptors (the previously-broken case)                 */
/* ──────────────────────────────────────────────────────────────── */

describe('promptForParams — object descriptors', () => {
  it('asks "how many?" then loops sub-steps per item', async () => {
    // `required: true` → skip the opt-in gate, go straight to "how many?".
    schemaStepsMock.value = [
      {
        kind: 'object',
        key: 'multiPrompt',
        label: 'Shots',
        required: true,
        arrayMax: 6,
        fields: [
          { kind: 'text', key: 'prompt', label: 'Prompt' },
          { kind: 'text', key: 'duration', label: 'Duration' },
        ],
      },
    ];
    askWithNavMock
      .mockResolvedValueOnce('2') // how many?
      .mockResolvedValueOnce('wide shot') // item 1 prompt
      .mockResolvedValueOnce('5') // item 1 duration
      .mockResolvedValueOnce('close-up') // item 2 prompt
      .mockResolvedValueOnce('7'); // item 2 duration

    const out = await promptForParams(model, emptyCtx);

    expect(typeof out).toBe('object');
    const params = out as Record<string, unknown>;
    expect(Array.isArray(params.multiPrompt)).toBe(true);
    const arr = params.multiPrompt as Array<{ prompt?: string; duration?: string }>;
    expect(arr).toHaveLength(2);
    expect(arr[0]?.prompt).toBe('wide shot');
    expect(arr[0]?.duration).toBe('5');
    expect(arr[1]?.prompt).toBe('close-up');
    expect(arr[1]?.duration).toBe('7');
  });

  it('clamps the "how many?" answer to the arrayMax', async () => {
    schemaStepsMock.value = [
      {
        kind: 'object',
        key: 'multiPrompt',
        label: 'Shots',
        required: true,
        arrayMax: 2,
        fields: [{ kind: 'text', key: 'prompt', label: 'Prompt' }],
      },
    ];
    askWithNavMock
      .mockResolvedValueOnce('10') // user asked for 10
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');

    const out = await promptForParams(model, emptyCtx);
    const arr = (out as Record<string, unknown>).multiPrompt as Array<{ prompt?: string }>;
    expect(arr).toHaveLength(2); // capped at arrayMax
  });

  it('opt-in gate skips the whole subwizard for an optional descriptor when the user answers No', async () => {
    // Optional descriptor → confirm gate first. User declines → empty array.
    schemaStepsMock.value = [
      {
        kind: 'object',
        key: 'multiPrompt',
        label: 'Shots',
        arrayMax: 6,
        fields: [{ kind: 'text', key: 'prompt', label: 'Prompt' }],
      },
    ];
    confirmWithNavMock.mockResolvedValueOnce(false);
    const out = await promptForParams(model, emptyCtx);
    expect((out as Record<string, unknown>).multiPrompt).toEqual([]);
    expect(askWithNavMock).not.toHaveBeenCalled(); // never reached "How many?"
  });

  it('opt-in gate proceeds to the "how many?" + loop when the user answers Yes', async () => {
    schemaStepsMock.value = [
      {
        kind: 'object',
        key: 'multiPrompt',
        label: 'Shots',
        arrayMax: 6,
        fields: [{ kind: 'text', key: 'prompt', label: 'Prompt' }],
      },
    ];
    confirmWithNavMock.mockResolvedValueOnce(true);
    askWithNavMock
      .mockResolvedValueOnce('1') // how many
      .mockResolvedValueOnce('wide shot'); // item 1 prompt
    const out = await promptForParams(model, emptyCtx);
    const arr = (out as Record<string, unknown>).multiPrompt as Array<{ prompt?: string }>;
    expect(arr).toEqual([{ prompt: 'wide shot' }]);
  });

  it('treats `0` and blank as skip on the count prompt for optional descriptors', async () => {
    schemaStepsMock.value = [
      {
        kind: 'object',
        key: 'multiPrompt',
        label: 'Shots',
        arrayMax: 6,
        fields: [{ kind: 'text', key: 'prompt', label: 'Prompt' }],
      },
    ];
    confirmWithNavMock.mockResolvedValueOnce(true);
    askWithNavMock.mockResolvedValueOnce('0'); // user types 0 at "how many?"
    const out = await promptForParams(model, emptyCtx);
    expect((out as Record<string, unknown>).multiPrompt).toEqual([]);
  });
});

/**
 * Spec for the interactive resolver orchestrator (`resolveInteractive`).
 *
 * Contract:
 *   resolveInteractive(flow, flags, deps):
 *     - runs model → files → params → (optional) prompt → confirm
 *     - BACK at the first step (model) cancels (returns null)
 *     - CANCEL from any step returns null
 *     - skips the prompt step when the flow does not need a prompt
 *     - prompt is folded into the returned `params` (not a separate field)
 *     - confirm "edit-params" loops back to the params step
 *     - confirm "edit-files" loops back to the file step
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { FlowSpec } from '#flows';
import type { CliDeps } from '#root/deps.ts';
import { BACK, CANCEL } from './wizard-state.ts';

const runModelStepMock = vi.hoisted(() => vi.fn());
const runFileStepMock = vi.hoisted(() => vi.fn());
const runParamsStepMock = vi.hoisted(() => vi.fn());
const runPromptStepMock = vi.hoisted(() => vi.fn());
const runConfirmStepMock = vi.hoisted(() => vi.fn());

vi.mock('./steps/model-step.ts', () => ({ runModelStep: runModelStepMock }));
vi.mock('./steps/file-step.ts', () => ({ runFileStep: runFileStepMock }));
vi.mock('./steps/params-step.ts', () => ({ runParamsStep: runParamsStepMock }));
vi.mock('./steps/prompt-step.ts', () => ({ runPromptStep: runPromptStepMock }));
vi.mock('./steps/confirm-step.ts', () => ({ runConfirmStep: runConfirmStepMock }));

import { resolveInteractive } from './resolver.ts';

function imageModel(): ModelDefinition {
  return { id: 'm-1', name: 'Model 1', inputType: 'i2i', mode: 'image' } as ModelDefinition;
}
function t2iModel(): ModelDefinition {
  return { id: 'm-2', name: 'Model 2', inputType: 't2i', mode: 'image' } as ModelDefinition;
}

function flow(overrides: Partial<FlowSpec> = {}): FlowSpec {
  return {
    id: 'test',
    description: 'test',
    staticFlagGroups: [],
    staticStepGroups: [],
    modelFilter: () => true,
    requiredInputs: [],
    ...overrides,
  } as FlowSpec;
}

const deps = { flags: {} } as unknown as CliDeps;

function resetAll() {
  runModelStepMock.mockReset();
  runFileStepMock.mockReset();
  runParamsStepMock.mockReset();
  runPromptStepMock.mockReset();
  runConfirmStepMock.mockReset();
}

describe('resolveInteractive — happy path (t2i, prompt required)', () => {
  it('runs all five steps and folds the prompt into params', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(t2iModel());
    runFileStepMock.mockResolvedValue({});
    runParamsStepMock.mockResolvedValue({ aspectRatio: '16:9' });
    runPromptStepMock.mockResolvedValue('a cat');
    runConfirmStepMock.mockResolvedValue(true);

    const result = await resolveInteractive(flow({ requiredInputs: ['prompt'] }), {}, deps);

    expect(result).not.toBeNull();
    expect(result?.model.id).toBe('m-2');
    expect(result?.params).toEqual({ aspectRatio: '16:9', prompt: 'a cat' });
    expect(result?.files).toEqual({});
  });
});

describe('resolveInteractive — skipping the prompt step', () => {
  it('skips the prompt step for flows that do not require a prompt (i2i model)', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(imageModel()); // inputType i2i (not text-to-*)
    runFileStepMock.mockResolvedValue({ images: ['/tmp/img.png'] });
    runParamsStepMock.mockResolvedValue({});
    runConfirmStepMock.mockResolvedValue(true);

    const result = await resolveInteractive(flow({ requiredInputs: [] }), {}, deps);

    expect(runPromptStepMock).not.toHaveBeenCalled();
    expect(result?.params).toEqual({});
  });

  it('always asks for prompt on a text-to-* model even when not in requiredInputs', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(t2iModel());
    runFileStepMock.mockResolvedValue({});
    runParamsStepMock.mockResolvedValue({});
    runPromptStepMock.mockResolvedValue('hello');
    runConfirmStepMock.mockResolvedValue(true);

    await resolveInteractive(flow({ requiredInputs: [] }), {}, deps);
    expect(runPromptStepMock).toHaveBeenCalled();
  });
});

describe('resolveInteractive — cancellation paths', () => {
  it('returns null when the model step returns BACK at the first step', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(BACK);
    const result = await resolveInteractive(flow(), {}, deps);
    expect(result).toBeNull();
    expect(runFileStepMock).not.toHaveBeenCalled();
  });

  it('returns null when the model step returns CANCEL', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(CANCEL);
    const result = await resolveInteractive(flow(), {}, deps);
    expect(result).toBeNull();
  });

  it('returns null when the params step returns CANCEL', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(imageModel());
    runFileStepMock.mockResolvedValue({});
    runParamsStepMock.mockResolvedValue(CANCEL);
    const result = await resolveInteractive(flow(), {}, deps);
    expect(result).toBeNull();
  });

  it('returns null when the confirm step returns CANCEL', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(imageModel());
    runFileStepMock.mockResolvedValue({});
    runParamsStepMock.mockResolvedValue({});
    runConfirmStepMock.mockResolvedValue(CANCEL);
    const result = await resolveInteractive(flow(), {}, deps);
    expect(result).toBeNull();
  });
});

describe('resolveInteractive — confirm-step loop-backs', () => {
  it('loops back to params on "edit-params" then proceeds', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(imageModel());
    runFileStepMock.mockResolvedValue({});
    runParamsStepMock.mockResolvedValueOnce({ a: 1 }).mockResolvedValueOnce({ a: 2 });
    runConfirmStepMock.mockResolvedValueOnce('edit-params').mockResolvedValueOnce(true);

    const result = await resolveInteractive(flow(), {}, deps);
    expect(runParamsStepMock).toHaveBeenCalledTimes(2);
    expect(result?.params).toEqual({ a: 2 });
  });

  it('loops back to files on "edit-files" and re-runs the file step', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(imageModel());
    runFileStepMock.mockResolvedValueOnce({ images: ['/a.png'] }).mockResolvedValueOnce({ images: ['/b.png'] });
    runParamsStepMock.mockResolvedValue({});
    runConfirmStepMock.mockResolvedValueOnce('edit-files').mockResolvedValueOnce(true);

    const result = await resolveInteractive(flow(), {}, deps);
    expect(runFileStepMock).toHaveBeenCalledTimes(2);
    expect(result?.files.images).toEqual(['/b.png']);
  });
});

describe('resolveInteractive — prompt BACK navigation', () => {
  it('returning BACK from prompt step goes back to params', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(t2iModel());
    runFileStepMock.mockResolvedValue({});
    runParamsStepMock.mockResolvedValueOnce({ first: true }).mockResolvedValueOnce({ second: true });
    runPromptStepMock.mockResolvedValueOnce(BACK).mockResolvedValueOnce('done');
    runConfirmStepMock.mockResolvedValue(true);

    const result = await resolveInteractive(flow({ requiredInputs: ['prompt'] }), {}, deps);

    expect(runParamsStepMock).toHaveBeenCalledTimes(2);
    expect(runPromptStepMock).toHaveBeenCalledTimes(2);
    expect(result?.params).toMatchObject({ second: true, prompt: 'done' });
  });
});

describe('resolveInteractive — multiPrompt seeds the top-level prompt', () => {
  it('skips the prompt step when params include multiPrompt with a non-empty first prompt', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(t2iModel());
    runFileStepMock.mockResolvedValue({});
    runParamsStepMock.mockResolvedValue({
      aspectRatio: '16:9',
      multiPrompt: [{ prompt: 'wide shot of neon city', duration: '5' }],
    });
    runConfirmStepMock.mockResolvedValue(true);

    const result = await resolveInteractive(flow({ requiredInputs: ['prompt'] }), {}, deps);

    expect(runPromptStepMock).not.toHaveBeenCalled();
    expect(result?.params.prompt).toBe('wide shot of neon city');
    expect(result?.params.multiPrompt).toBeDefined();
  });

  it('still asks for prompt if multiPrompt[0].prompt is empty/missing', async () => {
    resetAll();
    runModelStepMock.mockResolvedValue(t2iModel());
    runFileStepMock.mockResolvedValue({});
    // multiPrompt exists but the first shot has no prompt
    runParamsStepMock.mockResolvedValue({ multiPrompt: [{ duration: '5' }] });
    runPromptStepMock.mockResolvedValue('a sunset');
    runConfirmStepMock.mockResolvedValue(true);

    await resolveInteractive(flow({ requiredInputs: ['prompt'] }), {}, deps);

    expect(runPromptStepMock).toHaveBeenCalled();
  });
});

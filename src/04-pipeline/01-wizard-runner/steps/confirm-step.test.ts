/**
 * Spec for the confirm step.
 *
 * Contract:
 *   runConfirmStep(deps, model, prompt, files, params):
 *     - renders a summary card via deps.out.result
 *     - maps selectWithNav answers:
 *         'run'    → true
 *         'edit'   → 'edit-params'
 *         'files'  → 'edit-files'
 *         BACK     → 'edit-params'
 *         CANCEL   → CANCEL
 *     - warns when nothing was provided (no prompt, no files, no params)
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { CliDeps } from '#root/deps.ts';
import { BACK, CANCEL } from '../wizard-state.ts';

const selectWithNavMock = vi.hoisted(() => vi.fn());
vi.mock('../nav.ts', () => ({ selectWithNav: selectWithNavMock }));
vi.mock('#infra/ui-core/components/card.ts', () => ({ renderCard: (lines: string[]) => lines.join('\n') }));
vi.mock('#infra/ui-core/components/key-value.ts', () => ({ renderKeyValue: () => 'kv' }));

import { runConfirmStep } from './confirm-step.ts';

const model: ModelDefinition = { id: 'm', name: 'M' } as ModelDefinition;

function makeDeps() {
  const calls = { result: [] as string[], warn: [] as string[] };
  const color = { dim: (s: string) => s, success: (s: string) => s };
  const deps = {
    color,
    out: {
      result: (s: string) => calls.result.push(s),
      warn: (s: string) => calls.warn.push(s),
    },
    flags: { plain: false },
  } as unknown as CliDeps;
  return { deps, calls };
}

describe('runConfirmStep — result routing', () => {
  it('maps "run" → true', async () => {
    selectWithNavMock.mockReset().mockResolvedValue('run');
    const { deps } = makeDeps();
    const out = await runConfirmStep(deps, model, 'p', {}, {});
    expect(out).toBe(true);
  });

  it('maps "edit" → "edit-params"', async () => {
    selectWithNavMock.mockReset().mockResolvedValue('edit');
    const { deps } = makeDeps();
    expect(await runConfirmStep(deps, model, 'p', {}, {})).toBe('edit-params');
  });

  it('maps "files" → "edit-files"', async () => {
    selectWithNavMock.mockReset().mockResolvedValue('files');
    const { deps } = makeDeps();
    expect(await runConfirmStep(deps, model, 'p', {}, {})).toBe('edit-files');
  });

  it('maps BACK → "edit-params"', async () => {
    selectWithNavMock.mockReset().mockResolvedValue(BACK);
    const { deps } = makeDeps();
    expect(await runConfirmStep(deps, model, 'p', {}, {})).toBe('edit-params');
  });

  it('maps CANCEL → CANCEL', async () => {
    selectWithNavMock.mockReset().mockResolvedValue(CANCEL);
    const { deps } = makeDeps();
    expect(await runConfirmStep(deps, model, 'p', {}, {})).toBe(CANCEL);
  });
});

describe('runConfirmStep — empty input warning', () => {
  it('warns when no prompt, no files, and no params were given', async () => {
    selectWithNavMock.mockReset().mockResolvedValue('run');
    const { deps, calls } = makeDeps();
    await runConfirmStep(deps, model, undefined, {}, {});
    expect(calls.warn.length).toBeGreaterThan(0);
  });

  it('does not warn when at least one input is set', async () => {
    selectWithNavMock.mockReset().mockResolvedValue('run');
    const { deps, calls } = makeDeps();
    await runConfirmStep(deps, model, 'hello', {}, {});
    expect(calls.warn.length).toBe(0);
  });
});

describe('runConfirmStep — summary rendering', () => {
  it('renders the summary card before prompting', async () => {
    selectWithNavMock.mockReset().mockResolvedValue('run');
    const { deps, calls } = makeDeps();
    await runConfirmStep(deps, model, 'a cat', { images: ['/i.png'] }, { aspectRatio: '16:9' });
    expect(calls.result.length).toBe(1);
  });
});

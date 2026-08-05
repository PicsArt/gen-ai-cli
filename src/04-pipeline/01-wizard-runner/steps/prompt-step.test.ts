/**
 * Spec for the prompt step.
 *
 * Contract:
 *   runPromptStep(deps, model, promptFlag?):
 *     - if --prompt flag is non-empty, returns it trimmed (no UI)
 *     - if the command box returns null → BACK
 *     - if the command box returns "\x00editor" → opens $EDITOR
 *         - editor returned empty → warns + BACK
 *         - editor returned text  → returns trimmed text
 *     - any other return is trimmed; empty after trim → BACK
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { CliDeps } from '#root/deps.ts';
import { BACK } from '../wizard-state.ts';

const promptWithCommandBoxMock = vi.hoisted(() => vi.fn());
const openEditorForPromptMock = vi.hoisted(() => vi.fn());

vi.mock('#infra/ui/prompt-box.ts', () => ({ promptWithCommandBox: promptWithCommandBoxMock }));
vi.mock('#pipeline/01-wizard-runner/prompts/prompt-params.ts', () => ({
  openEditorForPrompt: openEditorForPromptMock,
}));

import { runPromptStep } from './prompt-step.ts';

const model: ModelDefinition = { id: 'm', name: 'M' } as ModelDefinition;
function makeDeps(): CliDeps {
  return { out: { warn: vi.fn() } } as unknown as CliDeps;
}

describe('runPromptStep — flag fast path', () => {
  it('returns the flag trimmed without prompting', async () => {
    const out = await runPromptStep(makeDeps(), model, '  hello  ');
    expect(out).toBe('hello');
    expect(promptWithCommandBoxMock).not.toHaveBeenCalled();
  });

  it('treats whitespace-only flag as missing and prompts instead', async () => {
    promptWithCommandBoxMock.mockReset().mockResolvedValue('asked');
    const out = await runPromptStep(makeDeps(), model, '   ');
    expect(out).toBe('asked');
    expect(promptWithCommandBoxMock).toHaveBeenCalled();
  });
});

describe('runPromptStep — command box result', () => {
  it('returns BACK when the command box returns null', async () => {
    promptWithCommandBoxMock.mockReset().mockResolvedValue(null);
    const out = await runPromptStep(makeDeps(), model);
    expect(out).toBe(BACK);
  });

  it('returns the trimmed prompt text', async () => {
    promptWithCommandBoxMock.mockReset().mockResolvedValue('  sunset  ');
    const out = await runPromptStep(makeDeps(), model);
    expect(out).toBe('sunset');
  });

  it('returns BACK when the result is whitespace only', async () => {
    promptWithCommandBoxMock.mockReset().mockResolvedValue('   ');
    const out = await runPromptStep(makeDeps(), model);
    expect(out).toBe(BACK);
  });
});

describe('runPromptStep — $EDITOR escape sequence', () => {
  it('returns the editor output trimmed when non-empty', async () => {
    promptWithCommandBoxMock.mockReset().mockResolvedValue('\x00editor');
    openEditorForPromptMock.mockReset().mockReturnValue('  from editor  ');
    const out = await runPromptStep(makeDeps(), model);
    expect(out).toBe('from editor');
  });

  it('warns and returns BACK when the editor produced no content', async () => {
    promptWithCommandBoxMock.mockReset().mockResolvedValue('\x00editor');
    openEditorForPromptMock.mockReset().mockReturnValue('');
    const deps = makeDeps();
    const out = await runPromptStep(deps, model);
    expect(out).toBe(BACK);
    expect(deps.out.warn).toHaveBeenCalled();
  });
});

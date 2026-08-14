/**
 * Inquirer theme helpers — safePrompt cancel translation and the theme
 * honoring the ColorManager (NO_COLOR / --no-color) instead of raw chalk.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { UsageError } from '../errors/index.ts';
import { createColorManager } from '../ui-core/color.ts';
import { inquirerTheme, safePrompt } from './theme.ts';

describe('inquirerTheme', () => {
  afterEach(() => {
    // Restore the default auto-detected manager for other tests.
    createColorManager({ enabled: 'auto' });
  });

  it('renders unstyled when color is disabled (NO_COLOR / --no-color path)', () => {
    createColorManager({ enabled: false });
    expect(inquirerTheme.prefix).toBe('?');
    expect(inquirerTheme.style.highlight('choice')).toBe('choice');
    expect(inquirerTheme.style.help('hint')).toBe('hint');
    const tip = inquirerTheme.style.keysHelpTip([['↑↓', 'navigate']]);
    expect(tip).not.toContain('\x1b[');
    expect(tip).toContain('navigate');
  });

  it('renders styled when color is enabled', () => {
    createColorManager({ enabled: true });
    expect(inquirerTheme.prefix).toContain('\x1b[');
    expect(inquirerTheme.style.highlight('choice')).toContain('\x1b[');
  });
});

describe('safePrompt', () => {
  it('returns the wrapped prompt value on success', async () => {
    await expect(safePrompt(async () => 'answer')).resolves.toBe('answer');
  });

  it('translates ExitPromptError (Ctrl+C in inquirer) into the USER_CANCEL sentinel', async () => {
    const exitPromptError = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' });
    const promise = safePrompt(async () => {
      throw exitPromptError;
    });
    await expect(promise).rejects.toBeInstanceOf(UsageError);
    await expect(promise).rejects.toMatchObject({ message: 'USER_CANCEL' });
  });

  it('rethrows every other error unchanged', async () => {
    const boom = new Error('boom');
    await expect(
      safePrompt(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it('rethrows non-object rejections unchanged', async () => {
    await expect(
      safePrompt(async () => {
        throw 'string rejection';
      }),
    ).rejects.toBe('string rejection');
  });
});

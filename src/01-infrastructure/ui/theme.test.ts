/**
 * Inquirer theme helpers — safePrompt cancel translation.
 */
import { describe, expect, it } from 'vitest';
import { UsageError } from '../errors/index.ts';
import { safePrompt } from './theme.ts';

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

import { Flags } from '@oclif/core';

/**
 * Model selection flag shared by operation commands.
 */
export const modelFlags = {
  model: Flags.string({
    char: 'm',
    description: 'Model ID or name',
  }),
};

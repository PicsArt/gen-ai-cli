import { Flags } from '@oclif/core';

/**
 * Base flags shared by every command.
 * Controls output format, verbosity, and interactivity.
 */
export const baseFlags = {
  json: Flags.boolean({
    description: 'Output as JSON',
    default: false,
  }),
  plain: Flags.boolean({
    description: 'Plain output without formatting (for piping)',
    default: false,
  }),
  quiet: Flags.boolean({
    char: 'q',
    description: 'Suppress non-essential output',
    default: false,
  }),
  'no-color': Flags.boolean({
    description: 'Disable color output',
    default: false,
  }),
  'no-input': Flags.boolean({
    description: 'Disable all interactive prompts (fail if input needed)',
    default: false,
  }),
  debug: Flags.boolean({
    description: 'Show debug output',
    default: false,
  }),
};

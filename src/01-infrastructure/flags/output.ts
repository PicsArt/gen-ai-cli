import { Flags } from '@oclif/core';

/**
 * Output-related flags shared by operation commands.
 * Controls where and how results are delivered.
 */
export const outputFlags = {
  download: Flags.string({
    description: 'Download result to directory (default: ./output)',
  }),
  'save-to-drive': Flags.boolean({
    description: 'Save result to Picsart Drive (default: true)',
    default: true,
    allowNo: true,
  }),
  'drive-folder': Flags.string({
    description: 'Drive subfolder name (creates if needed)',
    default: 'gen-ai-cli',
  }),
  open: Flags.boolean({
    description: 'Open result in default app after completion',
    allowNo: true,
  }),
  clipboard: Flags.boolean({
    description: 'Copy result URL to clipboard',
    default: false,
  }),
  bell: Flags.boolean({
    description: 'Play terminal bell on completion',
    default: false,
  }),
  notify: Flags.boolean({
    description: 'Send desktop notification on completion',
    default: false,
  }),
};

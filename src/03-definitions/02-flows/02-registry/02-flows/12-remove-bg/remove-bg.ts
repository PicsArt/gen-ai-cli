/**
 * `gen-ai remove-bg` — remove the background of an image.
 *
 * i2i sub-category. Discriminator: `inputType === 'i2i'` AND toolId
 * indicates a background-removal tool (Picsart SOD, removebg, ...).
 */
import { hasToolIdMatching } from '../../../01-static/04-tool-id-match/index.ts';
import { defineFlow } from '../../01-flow-spec/index.ts';

const REMOVE_BG_TOOL = /\.(picsart-sod|removebg|remove-bg)/i;

export const REMOVE_BG_FLOW = defineFlow({
  id: 'remove-bg',
  description: 'Remove the background from an image',
  modelFilter: (m) => m.inputType === 'i2i' && m.disabled !== true && hasToolIdMatching(m, REMOVE_BG_TOOL),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image'],
  examples: [
    { command: 'gen-ai remove-bg -i ./photo.jpg', description: 'Remove background (auto-saved to Drive)' },
    {
      command: 'gen-ai remove-bg -m remove-bg-v1 -i ./photo.png --download ./out',
      description: 'Specific model, download locally',
    },
    {
      command: 'gen-ai remove-bg -i ./photo.jpg --no-save-to-drive --json',
      description: 'Skip Drive, output JSON result URL',
    },
  ],
});

export default REMOVE_BG_FLOW;

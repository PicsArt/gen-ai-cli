/**
 * `gen-ai remove-bg` — remove the background of an image.
 *
 * i2i sub-category. Discriminator: `inputType === 'i2i'` AND the model's
 * backend workflow indicates a background-removal tool (Picsart SOD —
 * salient-object detection — workflow `pcp/v2/sod`).
 */
import { matchesWorkflowOrId } from '../../../01-static/04-workflow-match/index.ts';
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

const REMOVE_BG = /\bsod\b|remove-?bg/i;

export const REMOVE_BG_FLOW = defineFlow({
  id: 'remove-bg',
  description: 'Remove the background from an image',
  modelFilter: (m) => m.inputType === 'i2i' && modelAvailable(m) && matchesWorkflowOrId(m, REMOVE_BG),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image'],
  examples: [
    { command: 'gen-ai remove-bg -i ./photo.jpg', description: 'Remove background (auto-saved to Drive)' },
    {
      command: 'gen-ai remove-bg -m picsart-sod-v8-2 -i ./photo.png --download ./out',
      description: 'Specific model, download locally',
    },
    {
      command: 'gen-ai remove-bg -i ./photo.jpg --no-save-to-drive --json',
      description: 'Skip Drive, output JSON result URL',
    },
  ],
});

export default REMOVE_BG_FLOW;

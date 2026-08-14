/**
 * `gen-ai change-bg` — replace the background of an image.
 *
 * i2i sub-category. Discriminator: `inputType === 'i2i'` AND the model's
 * backend workflow indicates a background-replacement tool (Picsart
 * smart-background `v4/smart-background`, Recraft `replaceBackground`).
 */
import { matchesWorkflowOrId } from '../../../01-static/04-workflow-match/index.ts';
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

const CHANGE_BG = /smart-background|replace-?background|change-?bg|replace-?bg/i;

export const CHANGE_BG_FLOW = defineFlow({
  id: 'change-bg',
  description: 'Replace the background of an image',
  modelFilter: (m) => m.inputType === 'i2i' && modelAvailable(m) && matchesWorkflowOrId(m, CHANGE_BG),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image', 'prompt'],
  examples: [
    {
      command: 'gen-ai change-bg -i ./photo.jpg -p "a sunny beach"',
      description: 'Replace background (auto-saved to Drive)',
    },
    {
      command: 'gen-ai change-bg -m picsart-change-bg -i ./photo.png -p "a city at night" --download ./out',
      description: 'Specific model, download locally',
    },
    {
      command: 'gen-ai change-bg -i ./photo.jpg -p "forest" --no-save-to-drive --json',
      description: 'Skip Drive, output JSON result URL',
    },
  ],
});

export default CHANGE_BG_FLOW;

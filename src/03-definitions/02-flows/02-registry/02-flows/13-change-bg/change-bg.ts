/**
 * `gen-ai change-bg` — replace the background of an image with a new one.
 *
 * i2i sub-category. Discriminator: i2i AND toolId indicates a
 * background-replace tool (Picsart change-bg, Recraft replace-bg, ...).
 */
import { hasToolIdMatching } from '../../../01-static/04-tool-id-match/index.ts';
import { defineFlow } from '../../01-flow-spec/index.ts';

const CHANGE_BG_TOOL = /\.(picsart-change-bg|replace-bg|change-bg)/i;

export const CHANGE_BG_FLOW = defineFlow({
  id: 'change-bg',
  description: 'Replace the background of an image',
  modelFilter: (m) => m.inputType === 'i2i' && m.disabled !== true && hasToolIdMatching(m, CHANGE_BG_TOOL),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image', 'prompt'],
  examples: [
    {
      command: 'gen-ai change-bg -i ./photo.jpg -p "a sunny beach"',
      description: 'Replace background (auto-saved to Drive)',
    },
    {
      command: 'gen-ai change-bg -m change-bg-v1 -i ./photo.png -p "a city at night" --download ./out',
      description: 'Specific model, download locally',
    },
    {
      command: 'gen-ai change-bg -i ./photo.jpg -p "forest" --no-save-to-drive --json',
      description: 'Skip Drive, output JSON result URL',
    },
  ],
});

export default CHANGE_BG_FLOW;

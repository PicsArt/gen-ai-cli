/**
 * `gen-ai enhance` — restore / improve an image without scaling it up.
 *
 * i2i sub-category. Discriminator: i2i AND toolId indicates an
 * "enhance" tool (Picsart enhance, Topaz enhance, ...).
 *
 * Distinct from `upscale` — enhance improves perceptual quality at
 * roughly the same resolution; upscale increases resolution.
 */
import { hasToolIdMatching } from '../../../01-static/04-tool-id-match/index.ts';
import { defineFlow } from '../../01-flow-spec/index.ts';

const ENHANCE_TOOL = /\.(picsart-enhance|topaz-enhance|enhance(?!.*upscale))/i;

export const ENHANCE_FLOW = defineFlow({
  id: 'enhance',
  description: 'Restore or improve an image without changing resolution',
  modelFilter: (m) => m.inputType === 'i2i' && m.disabled !== true && hasToolIdMatching(m, ENHANCE_TOOL),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image'],
  examples: [
    { command: 'gen-ai enhance -i ./photo.jpg', description: 'Enhance image (auto-saved to Drive)' },
    {
      command: 'gen-ai enhance -m upscale-v2 -i ./photo.png --download ./out',
      description: 'Specific model, download locally',
    },
    {
      command: 'gen-ai enhance -i ./photo.jpg --no-save-to-drive --json',
      description: 'Skip Drive, output JSON result URL',
    },
  ],
});

export default ENHANCE_FLOW;

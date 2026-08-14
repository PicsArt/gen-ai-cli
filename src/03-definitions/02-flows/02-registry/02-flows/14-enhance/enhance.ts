/**
 * `gen-ai enhance` — restore / improve an image without scaling it up.
 *
 * i2i sub-category. Discriminator: i2i AND the model's backend workflow
 * indicates an enhancement tool (Picsart enhance `pcp/v1/enhancement`).
 *
 * Distinct from `upscale` — enhance improves perceptual quality at
 * roughly the same resolution; upscale increases resolution. The pattern
 * therefore excludes anything that also mentions upscale.
 */
import { matchesWorkflowOrId } from '../../../01-static/04-workflow-match/index.ts';
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

const ENHANCE = /enhance(?!.*upscal)|enhancement/i;

export const ENHANCE_FLOW = defineFlow({
  id: 'enhance',
  description: 'Restore or improve an image without changing resolution',
  modelFilter: (m) => m.inputType === 'i2i' && modelAvailable(m) && matchesWorkflowOrId(m, ENHANCE),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image'],
  examples: [
    { command: 'gen-ai enhance -i ./photo.jpg', description: 'Enhance image (auto-saved to Drive)' },
    {
      command: 'gen-ai enhance -m picsart-enhance -i ./photo.png --download ./out',
      description: 'Specific model, download locally',
    },
    {
      command: 'gen-ai enhance -i ./photo.jpg --no-save-to-drive --json',
      description: 'Skip Drive, output JSON result URL',
    },
  ],
});

export default ENHANCE_FLOW;

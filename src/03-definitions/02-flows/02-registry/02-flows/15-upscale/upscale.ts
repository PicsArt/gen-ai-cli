/**
 * `gen-ai upscale` — increase image resolution.
 *
 * i2i sub-category. Discriminator: i2i AND the model's backend workflow
 * indicates an upscaler (Topaz `topaz/upscale/image`, Recraft
 * `creativeUpscale` / `crispUpscale`).
 *
 * Distinct from `enhance` — upscale increases resolution; enhance
 * improves perceptual quality at the same resolution.
 */
import { matchesWorkflowOrId } from '../../../01-static/04-workflow-match/index.ts';
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

const UPSCALE = /upscal/i;

export const UPSCALE_FLOW = defineFlow({
  id: 'upscale',
  description: 'Increase the resolution of an image',
  modelFilter: (m) => m.inputType === 'i2i' && modelAvailable(m) && matchesWorkflowOrId(m, UPSCALE),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image'],
  examples: ['gen-ai upscale -i small.png', 'gen-ai upscale -m topaz-upscale-image -i small.png --download ./out'],
});

export default UPSCALE_FLOW;

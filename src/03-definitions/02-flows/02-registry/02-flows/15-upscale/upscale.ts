/**
 * `gen-ai upscale` — increase image resolution.
 *
 * i2i sub-category. Discriminator: i2i AND toolId indicates an
 * upscaler (Topaz, Recraft creative/crisp-upscale, Bytedance upscaler).
 *
 * Distinct from `enhance` — upscale increases resolution; enhance
 * improves perceptual quality at the same resolution.
 */
import { hasToolIdMatching } from '../../../01-static/04-tool-id-match/index.ts';
import { defineFlow } from '../../01-flow-spec/index.ts';

const UPSCALE_TOOL = /\.(.*upscale|topaz-upscale|bytedance-upscaler)/i;

export const UPSCALE_FLOW = defineFlow({
  id: 'upscale',
  description: 'Increase the resolution of an image',
  modelFilter: (m) => m.inputType === 'i2i' && m.disabled !== true && hasToolIdMatching(m, UPSCALE_TOOL),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image'],
  examples: ['gen-ai upscale -i small.png'],
});

export default UPSCALE_FLOW;

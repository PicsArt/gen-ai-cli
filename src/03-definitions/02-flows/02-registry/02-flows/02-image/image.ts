/**
 * `gen-ai image` — text-to-image generation.
 *
 * Covers every t2i model (flux, sd, ideogram, recraft, gemini, qwen,
 * dalle, seedream, picsart-genai, ...). Discriminator:
 * `model.inputType === 't2i'`.
 */
import { defineFlow } from '../../01-flow-spec/index.ts';

export const IMAGE_FLOW = defineFlow({
  id: 'image',
  description: 'Generate an image from a text prompt',
  modelFilter: (m) => m.inputType === 't2i' && m.disabled !== true,
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['prompt'],
  examples: [
    'gen-ai image -p "a watercolor of a fox in the woods"',
    'gen-ai image -m flux-1.1-pro -p "modern logo, geometric"',
  ],
});

export default IMAGE_FLOW;

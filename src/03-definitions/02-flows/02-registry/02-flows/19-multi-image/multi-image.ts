/**
 * `gen-ai multi-image` — generate from multiple reference images.
 *
 * Covers every model whose `paramConfig.imageUrls.array.max > 1`. The
 * discriminator is descriptor-driven instead of workflow-pattern: any
 * vendor that ships a multi-image-input model surfaces here
 * automatically — currently spans t2i (Gemini Pro/Flash Image, Flux,
 * GPT-Image, Kling Image, Seedream, Qwen), i2i (Qwen edit), i2v
 * (Pika scenes/frames, Runway gen4-ref, HappyHorse), and v2v
 * (Wan, Seedance, HappyHorse).
 */
import type { ParamDescriptor } from '@picsart/ai-sdk';
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

export const MULTI_IMAGE_FLOW = defineFlow({
  id: 'multi-image',
  description: 'Generate from multiple reference images (any model that accepts an image array)',
  modelFilter: (m) => {
    if (!modelAvailable(m)) return false;
    const desc = m.paramConfig?.imageUrls?.descriptor as ParamDescriptor | undefined;
    if (!desc || desc.kind !== 'file') return false;
    const max = desc.array?.max;
    return typeof max === 'number' && max > 1;
  },
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image', 'prompt'],
  examples: [
    'gen-ai multi-image -m gemini-3.1-flash-image -i a.png -i b.png -p "combine into a single hero shot"',
    'gen-ai multi-image -m pika-2.2-scenes -i a.png -i b.png -i c.png -p "the three meet in a cafe"',
    'gen-ai multi-image -m gpt-image-2 -i ref1.jpg -i ref2.jpg -p "style transfer across the references"',
  ],
});

export default MULTI_IMAGE_FLOW;

/**
 * `gen-ai image-to-video` — animate a still image into a video.
 *
 * Covers every i2v model (kling, hailuo, luma-flash2, pika, runway-gen45,
 * veo, wan, sora, ...). Discriminator: `model.inputType === 'i2v'`.
 */
import { defineFlow } from '../../01-flow-spec/index.ts';

export const IMAGE_TO_VIDEO_FLOW = defineFlow({
  id: 'image-to-video',
  description: 'Animate a still image into a short video',
  modelFilter: (m) => m.inputType === 'i2v' && m.disabled !== true,
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image', 'prompt'],
  examples: [
    'gen-ai image-to-video -i photo.png -p "slow zoom in"',
    'gen-ai image-to-video -m kling-i2v -i scene.jpg -p "wind blowing through grass"',
  ],
});

export default IMAGE_TO_VIDEO_FLOW;

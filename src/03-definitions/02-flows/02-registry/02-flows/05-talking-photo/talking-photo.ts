/**
 * `gen-ai talking-photo` — audio-driven photo animation.
 *
 * Audio → video: drive a still photo with a voice track. Covers
 * kling-avatar, heygen-talking-photo, hailuo+audio, bytedance-omnihuman,
 * creatify, runway-avatar-video, veed-fabric. Discriminator:
 * `model.inputType === 'a2v'`.
 */
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

export const TALKING_PHOTO_FLOW = defineFlow({
  id: 'talking-photo',
  description: 'Animate a photo so it speaks the supplied audio',
  modelFilter: (m) => m.inputType === 'a2v' && modelAvailable(m),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image', 'audio'],
  examples: ['gen-ai talking-photo -i portrait.png -a speech.mp3'],
});

export default TALKING_PHOTO_FLOW;

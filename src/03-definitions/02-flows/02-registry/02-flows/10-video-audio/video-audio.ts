/**
 * `gen-ai video-audio` — add audio to a video (dub / lipsync / v2a).
 *
 * Covers kling-v2a and similar models that take a silent video and
 * produce one with an audio track. Discriminator:
 * `model.inputType === 'v2a'`.
 */
import { defineFlow } from '../../01-flow-spec/index.ts';

export const VIDEO_AUDIO_FLOW = defineFlow({
  id: 'video-audio',
  description: 'Add a generated audio track to an existing video',
  modelFilter: (m) => m.inputType === 'v2a' && m.disabled !== true,
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['video'],
  examples: ['gen-ai video-audio --video silent.mp4 -p "city ambience with distant traffic"'],
});

export default VIDEO_AUDIO_FLOW;

/**
 * `gen-ai video-edit` — video-to-video editing / restyling.
 *
 * Covers runway-aleph, wan-video-edit, seedance-video-edit, ltx-retake,
 * kling-motion-control, and similar v2v models. Discriminator:
 * `model.inputType === 'v2v'`.
 */
import { defineFlow } from '../../01-flow-spec/index.ts';

export const VIDEO_EDIT_FLOW = defineFlow({
  id: 'video-edit',
  description: 'Edit, restyle, or transform an existing video',
  modelFilter: (m) => m.inputType === 'v2v' && m.disabled !== true,
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['video', 'prompt'],
  examples: ['gen-ai video-edit --video clip.mp4 -p "make it look like an oil painting"'],
});

export default VIDEO_EDIT_FLOW;

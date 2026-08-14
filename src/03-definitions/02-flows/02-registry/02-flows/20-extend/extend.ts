/**
 * `gen-ai extend` — extend an existing video by a few seconds.
 *
 * v2v sub-category. Discriminator: v2v AND an extension workflow or id.
 * Vendors spell it differently — LTX `ltx-2.3/extend-video`, OpenAI/Grok
 * `…/videos/extensions`, seedance only in the model id
 * (`seedance-2.0-video-extend`; its workflow is the uninformative
 * `"seedance"` shared with the edit variants).
 */
import { matchesWorkflowOrId } from '../../../01-static/04-workflow-match/index.ts';
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

const EXTEND = /extend|extension/i;

export const EXTEND_FLOW = defineFlow({
  id: 'extend',
  description: 'Extend an existing video by a few seconds',
  modelFilter: (m) => m.inputType === 'v2v' && modelAvailable(m) && matchesWorkflowOrId(m, EXTEND),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['video'],
  examples: [
    'gen-ai extend --video clip.mp4',
    'gen-ai extend -m sora-2-extend --video clip.mp4 -p "a sudden gust of wind"',
  ],
});

export default EXTEND_FLOW;

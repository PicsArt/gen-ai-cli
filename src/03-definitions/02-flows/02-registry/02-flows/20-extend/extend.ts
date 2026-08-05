/**
 * `gen-ai extend` — extend an existing video.
 *
 * Covers VEO, Sora-2, LTX, Grok video-extension models. These are
 * formally v2v (video → video) but the toolId names the operation
 * explicitly. Discriminator: v2v AND toolId matches an "extend"
 * pattern.
 */
import { hasToolIdMatching } from '../../../01-static/04-tool-id-match/index.ts';
import { defineFlow } from '../../01-flow-spec/index.ts';

const EXTEND_TOOL = /\.(.*extend|extend.*)/i;

export const EXTEND_FLOW = defineFlow({
  id: 'extend',
  description: 'Extend an existing video by a few seconds',
  modelFilter: (m) => m.inputType === 'v2v' && m.disabled !== true && hasToolIdMatching(m, EXTEND_TOOL),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['video'],
  examples: [
    'gen-ai extend --video clip.mp4',
    'gen-ai extend -m veo-3-extend --video clip.mp4 -p "a sudden gust of wind"',
  ],
});

export default EXTEND_FLOW;

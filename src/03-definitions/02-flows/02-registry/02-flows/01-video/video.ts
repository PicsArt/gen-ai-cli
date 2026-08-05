/**
 * `gen-ai video` — text-to-video generation.
 *
 * Covers every t2v model the SDK exposes (kling, veo, sora, seedance,
 * hailuo, ltx, wan, pika, luma, hunyuan, runway, grok, happyhorse, ...).
 *
 * Discriminator: `model.inputType === 't2v'`. Any new t2v model the
 * SDK adds appears here automatically — the predicate is the contract,
 * not a hardcoded model id list.
 */
import { defineFlow } from '../../01-flow-spec/index.ts';

export const VIDEO_FLOW = defineFlow({
  id: 'video',
  description: 'Generate a video from a text prompt',
  modelFilter: (m) => m.inputType === 't2v' && m.disabled !== true,
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['prompt'],
  examples: [
    'gen-ai video -p "a serene sunset over the ocean"',
    'gen-ai video -m kling-v2-master -p "a bustling city skyline at night"',
  ],
});

export default VIDEO_FLOW;

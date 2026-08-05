/**
 * `gen-ai describe` — analyze an image or video with an LLM.
 *
 * Surfaces the SDK's text/LLM models (`mode === 'text'`): Claude, GPT,
 * and Gemini. The user supplies an image (`-i`) or a video (`--video`)
 * plus an optional prompt; the model returns text, not media.
 *
 * Capability split (from the SDK catalog): every text model accepts
 * `imageUrls`, but only `gemini-3-pro` accepts `videoUrl`. The resolver's
 * text-analysis finalize step auto-routes video requests to Gemini.
 *
 * `requiredInputs` is empty on purpose: the requirement is "image OR
 * video", which the flat AND-list can't express. Media presence is
 * enforced in `finalizeTextAnalysisInputs` (resolver), which also
 * defaults the prompt when none is given.
 */
import { defineFlow } from '../../01-flow-spec/index.ts';

export const DESCRIBE_FLOW = defineFlow({
  id: 'describe',
  description: 'Analyze an image or video with an LLM',
  modelFilter: (m) => m.mode === 'text' && m.disabled !== true,
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: [],
  requiresMedia: true,
  defaultModel: 'claude-sonnet-4-6',
  examples: [
    'gen-ai describe -i photo.jpg',
    'gen-ai describe -i photo.jpg -p "what brand is the shoe?"',
    'gen-ai describe --video clip.mp4 -p "summarize what happens"',
  ],
});

export default DESCRIBE_FLOW;

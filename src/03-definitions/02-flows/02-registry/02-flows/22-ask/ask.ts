/**
 * `gen-ai ask` — general text/LLM access.
 *
 * Same text models as `describe` (`mode === 'text'`: Claude, GPT, Gemini), but
 * general-purpose: the prompt is the required input and media is **optional**.
 *
 *   gen-ai ask -p "find current trends in product photography"   # text-only
 *   gen-ai ask -p "what's in this image?" -i photo.jpg            # + image
 *   gen-ai ask -p "summarize this clip" --video clip.mp4          # + video (→ Gemini)
 *
 * Returns text, not media. Unlike `describe` (media analysis, media required),
 * `ask` answers from the model alone when no media is given. The resolver's
 * text finalize step still routes video requests to a video-capable model.
 *
 * Note: a plain LLM call answers from the model's training data, not the live
 * web — "current trends" reflects model knowledge, not real-time results.
 */
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

export const ASK_FLOW = defineFlow({
  id: 'ask',
  description: 'Ask an LLM — text in (optional image/video), text out',
  modelFilter: (m) => m.mode === 'text' && modelAvailable(m),
  staticFlagGroups: ['universal', 'model', 'prompt-input'],
  staticStepGroups: ['confirm'],
  requiredInputs: ['prompt'],
  defaultModel: 'claude-sonnet-4-6',
  examples: [
    'gen-ai ask -p "find current trends in AI video"',
    'gen-ai ask -p "what brand is this?" -i product.jpg',
    'gen-ai ask -p "summarize this clip" --video talk.mp4',
  ],
});

export default ASK_FLOW;

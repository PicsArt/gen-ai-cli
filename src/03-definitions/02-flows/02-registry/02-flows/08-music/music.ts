/**
 * `gen-ai music` — text → music generation.
 *
 * Covers lyria, minimax-music, and similar music models.
 * Discriminator: `model.inputType === 'music'`.
 */
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

export const MUSIC_FLOW = defineFlow({
  id: 'music',
  description: 'Generate music from a text prompt',
  modelFilter: (m) => m.inputType === 'music' && modelAvailable(m),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['prompt'],
  examples: ['gen-ai music -p "uplifting cinematic orchestral, 90 BPM"'],
});

export default MUSIC_FLOW;

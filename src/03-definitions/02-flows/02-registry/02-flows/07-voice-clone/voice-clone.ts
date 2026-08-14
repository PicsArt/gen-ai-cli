/**
 * `gen-ai voice-clone` — speech-to-speech voice transformation.
 *
 * Covers eleven-voice-design, eleven-sts, and similar sts models.
 * Discriminator: `model.inputType === 'sts'`.
 */
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

export const VOICE_CLONE_FLOW = defineFlow({
  id: 'voice-clone',
  description: 'Transform speech into a different voice',
  modelFilter: (m) => m.inputType === 'sts' && modelAvailable(m),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['audio'],
  examples: ['gen-ai voice-clone -a sample.mp3'],
});

export default VOICE_CLONE_FLOW;

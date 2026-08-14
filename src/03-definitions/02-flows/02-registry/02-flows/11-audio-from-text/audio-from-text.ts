/**
 * `gen-ai audio-from-text` — generic text → audio (non-speech, non-music).
 *
 * Discriminator: `model.inputType === 't2a'`. Most audio output flows
 * have their own dedicated InputType (`tts`, `music`, `sfx`); `t2a` is
 * the catch-all for models that don't fit those buckets.
 */
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

export const AUDIO_FROM_TEXT_FLOW = defineFlow({
  id: 'audio-from-text',
  description: 'Generate audio from text (generic t2a — see also text-to-speech, music, sfx)',
  modelFilter: (m) => m.inputType === 't2a' && modelAvailable(m),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['prompt'],
});

export default AUDIO_FROM_TEXT_FLOW;

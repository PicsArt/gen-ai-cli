/**
 * `gen-ai text-to-speech` — text → spoken audio.
 *
 * Covers elevenlabs, gemini-tts, openai-tts, grok-tts, minimax-02-hd,
 * kling-t2a. Discriminator: `model.inputType === 'tts'`.
 */
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

export const TEXT_TO_SPEECH_FLOW = defineFlow({
  id: 'text-to-speech',
  description: 'Synthesize speech from text',
  modelFilter: (m) => m.inputType === 'tts' && modelAvailable(m),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['prompt'],
  examples: [
    'gen-ai text-to-speech -p "Welcome to the demo, friend."',
    'gen-ai text-to-speech -m eleven-v3 -p "Hello world"',
  ],
});

export default TEXT_TO_SPEECH_FLOW;

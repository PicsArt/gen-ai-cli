/**
 * `gen-ai sfx` — text → sound effect generation.
 *
 * Covers elevenlabs-sfx and similar sfx models.
 * Discriminator: `model.inputType === 'sfx'`.
 */
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

export const SFX_FLOW = defineFlow({
  id: 'sfx',
  description: 'Generate a sound effect from a text prompt',
  modelFilter: (m) => m.inputType === 'sfx' && modelAvailable(m),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['prompt'],
  examples: ['gen-ai sfx -p "footsteps on wet pavement, slow tempo"'],
});

export default SFX_FLOW;

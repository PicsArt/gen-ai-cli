/**
 * `gen-ai character` — character-consistent image generation.
 *
 * Models that use one or more reference images to keep a character /
 * subject identity consistent across outputs (ideogram-character,
 * runway-gen4-ref, ...).
 *
 * These models surface a reference-image file descriptor in their
 * paramConfig, so the discriminator combines `inputType === 'i2i'`
 * with a toolId pattern that names the character-ref tool family.
 */
import { hasToolIdMatching } from '../../../01-static/04-tool-id-match/index.ts';
import { defineFlow } from '../../01-flow-spec/index.ts';

const CHARACTER_TOOL = /\.(ideogram-character|runway-gen4-ref|character)/i;

export const CHARACTER_FLOW = defineFlow({
  id: 'character',
  description: 'Generate images that keep a reference character consistent',
  modelFilter: (m) => m.inputType === 'i2i' && m.disabled !== true && hasToolIdMatching(m, CHARACTER_TOOL),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image', 'prompt'],
  examples: ['gen-ai character -i hero.png -p "the same person, in a snowy forest"'],
});

export default CHARACTER_FLOW;

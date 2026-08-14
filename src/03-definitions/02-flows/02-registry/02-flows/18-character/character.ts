/**
 * `gen-ai character` — generate images that keep a reference character
 * consistent.
 *
 * i2i sub-category. Discriminator: i2i AND a character/reference model.
 * ideogram-character's workflow (`ideogram-v3-generate`) is shared with
 * plain generation, so the model id carries the signal there;
 * runway-gen4-ref matches on both id and workflow
 * (`runway-gen4-image-ref`).
 */
import { matchesWorkflowOrId } from '../../../01-static/04-workflow-match/index.ts';
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

const CHARACTER = /character|gen4-(image-)?ref/i;

export const CHARACTER_FLOW = defineFlow({
  id: 'character',
  description: 'Generate images that keep a reference character consistent',
  modelFilter: (m) => m.inputType === 'i2i' && modelAvailable(m) && matchesWorkflowOrId(m, CHARACTER),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image', 'prompt'],
  examples: ['gen-ai character -i hero.png -p "the same person, in a snowy forest"'],
});

export default CHARACTER_FLOW;

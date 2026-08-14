/**
 * `gen-ai edit-image` — edit an image with a text prompt.
 *
 * i2i sub-category. Discriminator: i2i AND the model's backend workflow
 * indicates a prompted image editor (Qwen image-edit family
 * `pcp/v1/qwen-image-edit`, `qwen-image-edit-plus`, Qwen makeup
 * `pcp/v2/qwen-makeup`).
 */
import { matchesWorkflowOrId } from '../../../01-static/04-workflow-match/index.ts';
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

const EDIT_IMAGE = /image-edit|qwen-makeup/i;

export const EDIT_IMAGE_FLOW = defineFlow({
  id: 'edit-image',
  description: 'Edit an image with a text prompt',
  modelFilter: (m) => m.inputType === 'i2i' && modelAvailable(m) && matchesWorkflowOrId(m, EDIT_IMAGE),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image', 'prompt'],
  examples: ['gen-ai edit-image -i photo.png -p "make the sky look like a sunset"'],
});

export default EDIT_IMAGE_FLOW;

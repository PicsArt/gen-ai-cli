/**
 * `gen-ai edit-image` — prompt-driven image editing.
 *
 * i2i sub-category. Discriminator: i2i AND toolId indicates a
 * prompt-driven editor (flux-kontext, qwen-image-edit, qwen-edit-plus,
 * qwen-makeup, gemini-2.5-flash-image, seedream edit, ...).
 *
 * Distinct from the operation-specific i2i flows (remove-bg, change-bg,
 * enhance, upscale, vectorize) which use task-fixed tools.
 */
import { hasToolIdMatching } from '../../../01-static/04-tool-id-match/index.ts';
import { defineFlow } from '../../01-flow-spec/index.ts';

const EDIT_TOOL =
  /\.(flux-kontext|qwen-image-edit|qwen-edit-plus|qwen-makeup|gemini-2\.5-flash-image|seedream.*edit|image-edit)/i;

export const EDIT_IMAGE_FLOW = defineFlow({
  id: 'edit-image',
  description: 'Edit an image with a text prompt',
  modelFilter: (m) => m.inputType === 'i2i' && m.disabled !== true && hasToolIdMatching(m, EDIT_TOOL),
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image', 'prompt'],
  examples: ['gen-ai edit-image -i photo.png -p "make the sky look like a sunset"'],
});

export default EDIT_IMAGE_FLOW;

/**
 * `gen-ai vectorize` — raster → vector conversion.
 *
 * i2i sub-category. Discriminator: i2i AND toolId indicates a
 * vectorizer (Recraft vectorize, recraftvX-vector variants).
 */
import { hasToolIdMatching } from '../../../01-static/04-tool-id-match/index.ts';
import { defineFlow } from '../../01-flow-spec/index.ts';

const VECTORIZE_TOOL = /(vectorize|-vector\b)/i;

export const VECTORIZE_FLOW = defineFlow({
  id: 'vectorize',
  description: 'Convert a raster image to a vector graphic',
  modelFilter: (m) => m.inputType === 'i2i' && m.disabled !== true && hasToolIdMatching(m, VECTORIZE_TOOL),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image'],
  examples: [
    { command: 'gen-ai vectorize -i ./logo.png', description: 'Vectorize image (auto-saved to Drive)' },
    {
      command: 'gen-ai vectorize -m vectorize-v2 -i ./logo.png --download ./out',
      description: 'Specific model, download locally',
    },
    {
      command: 'gen-ai vectorize -i ./logo.png --no-save-to-drive --json',
      description: 'Skip Drive, output JSON result URL',
    },
  ],
});

export default VECTORIZE_FLOW;

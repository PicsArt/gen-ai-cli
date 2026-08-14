/**
 * `gen-ai vectorize` — convert a raster image to a vector graphic.
 *
 * i2i sub-category. Discriminator: i2i AND the model's backend workflow
 * indicates a vectorizer (Recraft `recraft/v1/images/vectorize`).
 */
import { matchesWorkflowOrId } from '../../../01-static/04-workflow-match/index.ts';
import { defineFlow, modelAvailable } from '../../01-flow-spec/index.ts';

const VECTORIZE = /vector/i;

export const VECTORIZE_FLOW = defineFlow({
  id: 'vectorize',
  description: 'Convert a raster image to a vector graphic',
  modelFilter: (m) => m.inputType === 'i2i' && modelAvailable(m) && matchesWorkflowOrId(m, VECTORIZE),
  staticFlagGroups: ['universal', 'output', 'model', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['image'],
  examples: [
    { command: 'gen-ai vectorize -i ./logo.png', description: 'Vectorize image (auto-saved to Drive)' },
    {
      command: 'gen-ai vectorize -m recraft-vectorize -i ./logo.png --download ./out',
      description: 'Specific model, download locally',
    },
    {
      command: 'gen-ai vectorize -i ./logo.png --no-save-to-drive --json',
      description: 'Skip Drive, output JSON result URL',
    },
  ],
});

export default VECTORIZE_FLOW;

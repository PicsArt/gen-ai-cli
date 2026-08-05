/**
 * `gen-ai generate` — universal entry point.
 *
 * Unlike every other flow in the registry, `generate` does not narrow
 * to a single InputType or toolId sub-category. It is the umbrella that
 * lets a user run any non-disabled model through the same pipeline.
 *
 * Distinguishing properties:
 *   - `modelFilter` accepts every non-disabled model (universal).
 *   - `requiredInputs` is empty: the per-model paramConfig and the
 *     resolver decide what the user must supply once a model is chosen.
 *     (The registry-level test exempts this flow from the "must require
 *     ≥1 input" rule for that reason.)
 *
 * Specialized flows (`image`, `video`, `music`, …) remain the preferred
 * way to invoke a single category; `generate` is the discovery surface
 * for users who don't know the category names yet.
 */
import { defineFlow } from '../../01-flow-spec/index.ts';

export const GENERATE_FLOW = defineFlow({
  id: 'generate',
  description: 'Generate with any model — universal entry point',
  modelFilter: (m) => m.disabled !== true,
  staticFlagGroups: ['universal', 'output', 'model', 'prompt-input', 'directory-input'],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: [],
  examples: [
    'gen-ai generate                                # interactive picker',
    'gen-ai generate -m flux-1.1-pro -p "a fox in the woods"',
    'gen-ai generate -m veo-3 -p "neon-lit city street"',
  ],
});

export default GENERATE_FLOW;

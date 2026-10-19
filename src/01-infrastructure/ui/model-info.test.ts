/**
 * Model info renderer — smoke test against a real catalog model.
 */
import { ALL_MODELS, Model } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { createColorManager } from '../ui-core/color.ts';
import { renderModelInfoLines } from './model-info.ts';

const color = createColorManager({ enabled: false });

describe('renderModelInfoLines', () => {
  it('renders the core key-value fields for a catalog model', () => {
    const model = ALL_MODELS[0];
    const lines = renderModelInfoLines(model, color);
    const text = lines.join('\n');
    expect(text).toContain('ID');
    expect(text).toContain(model.id);
    expect(text).toContain('Provider');
    expect(text).toContain(model.provider);
    expect(text).toContain('Mode');
  });

  it('includes a Parameters section when the model has a schema', () => {
    const withSchema = ALL_MODELS.find((m) => Object.keys(Model(m.id).params().toSchema()).length > 0);
    if (!withSchema) return; // catalog without schemas — nothing to assert
    const lines = renderModelInfoLines(withSchema, color);
    expect(lines.join('\n')).toContain('Parameters');
  });
});

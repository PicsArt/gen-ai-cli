/**
 * composeWizardForFlow — verifies the wizard composer wiring:
 *   - emits a model picker built from runtime models
 *   - descriptor-derived steps come from the narrowed catalog only
 *   - static step groups splice in at the end, in spec order
 *   - order: [picker, ...descriptors, ...static]
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import type { ModelLike } from '#param-surface';
import { ALIAS_MAP, loadCatalog } from '#param-surface';
import { defineFlow } from '../../02-registry/01-flow-spec/index.ts';
import { composeWizardForFlow } from './wizard-flow.ts';

function mockModel(overrides: Partial<ModelDefinition>): ModelDefinition {
  return {
    id: 'mock',
    name: 'Mock Model',
    inputType: 't2v',
    mode: 'video',
    disabled: false,
    paramConfig: {},
    provider: 'picsart' as ModelDefinition['provider'],
    workflow: 'mock',
    providerName: 'Mock',
    providerColor: '#000',
    providerLabel: 'M',
    description: '',
    features: [],
    ...overrides,
  } as ModelDefinition;
}

const T2V_A: ModelDefinition = mockModel({
  id: 'kling-a',
  name: 'Kling A',
  inputType: 't2v',
  paramConfig: {
    prompt: { label: 'Prompt', required: true, descriptor: { kind: 'text', maxLength: 500 } },
  },
});

const T2V_B: ModelDefinition = mockModel({
  id: 'veo-b',
  name: 'Veo B',
  inputType: 't2v',
  paramConfig: {
    prompt: { descriptor: { kind: 'text', maxLength: 500 } },
    duration: { descriptor: { kind: 'enum', valueType: 'number', options: [{ id: 5 }, { id: 10 }], default: 5 } },
  },
});

const T2I_C: ModelDefinition = mockModel({
  id: 'flux-c',
  name: 'Flux C',
  inputType: 't2i',
  mode: 'image',
  paramConfig: { style: { descriptor: { kind: 'text' } } },
});

const VIDEO_FLOW = defineFlow({
  id: 'video',
  description: 'Test t2v flow',
  modelFilter: (m) => m.inputType === 't2v' && m.disabled !== true,
  staticFlagGroups: [],
  staticStepGroups: ['output', 'confirm'],
  requiredInputs: ['prompt'],
});

function asCatalogModels(models: readonly ModelDefinition[]): readonly ModelLike[] {
  return models.map((m) => ({ id: m.id, paramConfig: m.paramConfig }));
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  No matches                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

describe('composeWizardForFlow — no matching models', () => {
  it('emits no model picker and no descriptor steps; static groups still appear', () => {
    const cat = loadCatalog([], ALIAS_MAP);
    const steps = composeWizardForFlow(VIDEO_FLOW, cat, [T2I_C]);
    expect(steps.find((s) => s.key === '$model')).toBeUndefined();
    // static groups still spliced
    expect(steps.find((s) => s.key === 'downloadPath')).toBeDefined();
    expect(steps.find((s) => s.key === 'proceed')).toBeDefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Model picker                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('composeWizardForFlow — model picker', () => {
  it('emits a select step with one choice per matching model', () => {
    const cat = loadCatalog(asCatalogModels([T2V_A, T2V_B, T2I_C]), ALIAS_MAP);
    const steps = composeWizardForFlow(VIDEO_FLOW, cat, [T2V_A, T2V_B, T2I_C]);
    const picker = steps[0];
    if (picker.kind !== 'select') throw new Error('expected select');
    expect(picker.key).toBe('$model');
    expect(picker.choices.map((c) => c.id)).toEqual(['kling-a', 'veo-b']);
    expect(picker.required).toBe(true);
  });

  it('pre-fills the default when there is only one matching model', () => {
    const cat = loadCatalog(asCatalogModels([T2V_A, T2I_C]), ALIAS_MAP);
    const steps = composeWizardForFlow(VIDEO_FLOW, cat, [T2V_A, T2I_C]);
    const picker = steps[0];
    if (picker.kind !== 'select') throw new Error('expected select');
    expect(picker.default).toBe('kling-a');
  });

  it('honors `defaultModel` from the FlowSpec when set', () => {
    const flow = defineFlow({ ...VIDEO_FLOW, defaultModel: 'veo-b' });
    const cat = loadCatalog(asCatalogModels([T2V_A, T2V_B]), ALIAS_MAP);
    const steps = composeWizardForFlow(flow, cat, [T2V_A, T2V_B]);
    const picker = steps[0];
    if (picker.kind !== 'select') throw new Error('expected select');
    expect(picker.default).toBe('veo-b');
  });

  it('uses `model.name` for the choice label when present', () => {
    const cat = loadCatalog(asCatalogModels([T2V_A]), ALIAS_MAP);
    const steps = composeWizardForFlow(VIDEO_FLOW, cat, [T2V_A]);
    const picker = steps[0];
    if (picker.kind !== 'select') throw new Error('expected select');
    expect(picker.choices[0].label).toBe('Kling A');
  });

  it('never collides with an SDK descriptor literally named `model` (Topaz engine, Flux tier)', () => {
    // A real SDK-5 case: enhance/upscale models declare a `model` param
    // (the engine/tier picker, shipped as --model-version). The runner
    // keys answers by step.key, so the picker key must stay disjoint —
    // it uses the runner-owned '$model' namespace.
    const withModelParam: ModelDefinition = {
      ...T2V_A,
      paramConfig: {
        ...T2V_A.paramConfig,
        model: {
          label: 'Engine',
          descriptor: {
            kind: 'enum',
            valueType: 'string',
            options: [{ id: 'High Fidelity V2' }, { id: 'Standard V2' }],
            default: 'High Fidelity V2',
          },
        },
      } as ModelDefinition['paramConfig'],
    };
    const cat = loadCatalog(asCatalogModels([withModelParam]), ALIAS_MAP);
    const steps = composeWizardForFlow(VIDEO_FLOW, cat, [withModelParam]);

    const keys = steps.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate answer slots

    const picker = steps.find((s) => s.key === '$model');
    const engine = steps.find((s) => s.key === 'model');
    expect(picker?.kind).toBe('select');
    expect(engine?.kind).toBe('select');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Descriptor steps                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('composeWizardForFlow — descriptor steps', () => {
  it('emits one step per descriptor key from matching models, in catalog order', () => {
    const cat = loadCatalog(asCatalogModels([T2V_A, T2V_B, T2I_C]), ALIAS_MAP);
    const steps = composeWizardForFlow(VIDEO_FLOW, cat, [T2V_A, T2V_B, T2I_C]);
    const keys = steps.map((s) => s.key);
    expect(keys).toContain('prompt');
    expect(keys).toContain('duration');
    // T2I-only descriptor key 'style' must NOT appear
    expect(keys).not.toContain('style');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Order and static groups                                               */
/* ─────────────────────────────────────────────────────────────────────── */

describe('composeWizardForFlow — order', () => {
  it('produces [picker, ...descriptors, ...static groups in spec order]', () => {
    const cat = loadCatalog(asCatalogModels([T2V_A, T2V_B]), ALIAS_MAP);
    const steps = composeWizardForFlow(VIDEO_FLOW, cat, [T2V_A, T2V_B]);
    const keys = steps.map((s) => s.key);

    expect(keys[0]).toBe('$model'); // picker first

    const promptIdx = keys.indexOf('prompt');
    const downloadIdx = keys.indexOf('downloadPath');
    const proceedIdx = keys.indexOf('proceed');

    expect(promptIdx).toBeGreaterThan(0); // after picker
    expect(downloadIdx).toBeGreaterThan(promptIdx); // static after descriptors
    expect(proceedIdx).toBeGreaterThan(downloadIdx); // confirm after output
  });

  it('omits static groups not on the spec', () => {
    const flow = defineFlow({ ...VIDEO_FLOW, staticStepGroups: [] });
    const cat = loadCatalog(asCatalogModels([T2V_A]), ALIAS_MAP);
    const steps = composeWizardForFlow(flow, cat, [T2V_A]);
    expect(steps.find((s) => s.key === 'downloadPath')).toBeUndefined();
    expect(steps.find((s) => s.key === 'proceed')).toBeUndefined();
  });
});

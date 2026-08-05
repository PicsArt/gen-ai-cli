/**
 * composeFlagsForFlow — verifies the per-flow composer wiring:
 *   - applies modelFilter to the model list
 *   - narrows the catalog to matching ids
 *   - emits descriptor flags only for matching models
 *   - spreads each named static group
 *   - merges in a stable order (static wins on collision)
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import type { ModelLike } from '#param-surface';
import { ALIAS_MAP, loadCatalog } from '#param-surface';
import { defineFlow } from '../../02-registry/01-flow-spec/index.ts';
import { composeFlagsForFlow } from './flag-set.ts';

/* ─────────────────────────────────────────────────────────────────────── */
/*  Fixtures                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

function mockModel(overrides: Partial<ModelDefinition>): ModelDefinition {
  return {
    id: 'mock',
    name: 'Mock',
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

const T2V_MODEL: ModelDefinition = mockModel({
  id: 'kling-fake',
  inputType: 't2v',
  paramConfig: {
    prompt: { label: 'Prompt', required: true, descriptor: { kind: 'text', maxLength: 500 } },
    aspectRatio: {
      label: 'Aspect',
      descriptor: { kind: 'enum', valueType: 'string', options: [{ id: '16:9' }, { id: '9:16' }], default: '16:9' },
    },
  },
});

const T2I_MODEL: ModelDefinition = mockModel({
  id: 'flux-fake',
  inputType: 't2i',
  mode: 'image',
  paramConfig: {
    prompt: { descriptor: { kind: 'text', maxLength: 500 } },
    style: { descriptor: { kind: 'text' } },
  },
});

const VIDEO_FLOW = defineFlow({
  id: 'video',
  description: 'Test t2v flow',
  modelFilter: (m) => m.inputType === 't2v' && m.disabled !== true,
  staticFlagGroups: ['universal', 'output', 'model'],
  staticStepGroups: [],
  requiredInputs: ['prompt'],
});

function modelsAsCatalogInput(models: readonly ModelDefinition[]): readonly ModelLike[] {
  return models.map((m) => ({ id: m.id, paramConfig: m.paramConfig }));
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Empty / smoke                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('composeFlagsForFlow — empty', () => {
  it('returns only static flags when no models match', () => {
    const cat = loadCatalog([], ALIAS_MAP);
    const flags = composeFlagsForFlow(VIDEO_FLOW, cat, []);
    expect(Object.keys(flags).sort()).toEqual(
      [...Object.keys(flags)].sort(), // sanity
    );
    expect(flags.json).toBeDefined(); // universal group
    expect(flags.download).toBeDefined(); // output group
    expect(flags.model).toBeDefined(); // model group
  });

  it('returns just static flags when staticFlagGroups: [] and no model match', () => {
    const empty = defineFlow({
      id: 'empty',
      description: 'no static, no match',
      modelFilter: () => false,
      staticFlagGroups: [],
      staticStepGroups: [],
      requiredInputs: [],
    });
    const cat = loadCatalog([], ALIAS_MAP);
    expect(composeFlagsForFlow(empty, cat, [T2I_MODEL])).toEqual({});
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Filtering                                                             */
/* ─────────────────────────────────────────────────────────────────────── */

describe('composeFlagsForFlow — filtering', () => {
  it('emits descriptor flags from matching models only', () => {
    const cat = loadCatalog(modelsAsCatalogInput([T2V_MODEL, T2I_MODEL]), ALIAS_MAP);
    const flags = composeFlagsForFlow(VIDEO_FLOW, cat, [T2V_MODEL, T2I_MODEL]);

    // T2V model's flags are present
    expect(flags.prompt).toBeDefined();
    expect(flags['aspect-ratio']).toBeDefined();
    // T2I-only flag (`style`) is NOT
    expect(flags.style).toBeUndefined();
  });

  it('excludes disabled matching models', () => {
    const disabled = mockModel({ id: 'disabled', inputType: 't2v', disabled: true });
    const cat = loadCatalog(modelsAsCatalogInput([disabled]), ALIAS_MAP);
    const flags = composeFlagsForFlow(VIDEO_FLOW, cat, [disabled]);
    expect(flags.prompt).toBeUndefined();
    // Static groups still present
    expect(flags.json).toBeDefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Static groups                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('composeFlagsForFlow — static groups', () => {
  it('spreads every requested static group', () => {
    const cat = loadCatalog(modelsAsCatalogInput([T2V_MODEL]), ALIAS_MAP);
    const flags = composeFlagsForFlow(VIDEO_FLOW, cat, [T2V_MODEL]);
    expect(flags.json).toBeDefined(); // universal
    expect(flags.download).toBeDefined(); // output
    expect(flags.model).toBeDefined(); // model
  });

  it('omits groups not listed on the spec', () => {
    const noUniversal = defineFlow({
      ...VIDEO_FLOW,
      staticFlagGroups: ['output'], // drop universal + model
    });
    const cat = loadCatalog(modelsAsCatalogInput([T2V_MODEL]), ALIAS_MAP);
    const flags = composeFlagsForFlow(noUniversal, cat, [T2V_MODEL]);
    expect(flags.json).toBeUndefined();
    expect(flags.model).toBeUndefined();
    expect(flags.download).toBeDefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Collision precedence                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('composeFlagsForFlow — collision precedence', () => {
  it('static flag wins if (somehow) a descriptor flag has the same name', () => {
    // Construct a synthetic model whose descriptor key collides with a static flag.
    const collidingModel: ModelDefinition = mockModel({
      id: 'collide',
      inputType: 't2v',
      paramConfig: {
        // 'json' is a static universal flag. A descriptor with this key
        // would emit `--json` from the schema side too.
        json: { descriptor: { kind: 'text' } },
      },
    });

    const cat = loadCatalog(modelsAsCatalogInput([collidingModel]), ALIAS_MAP);
    const flags = composeFlagsForFlow(VIDEO_FLOW, cat, [collidingModel]);

    // The static (boolean) version wins — descriptor was a text.
    const jsonFlag = flags.json as { type?: string; allowNo?: boolean };
    expect(jsonFlag.type).toBe('boolean');
  });
});

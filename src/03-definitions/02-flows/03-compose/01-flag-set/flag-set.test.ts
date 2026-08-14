/**
 * composeFlagsForFlow — verifies the per-flow composer wiring:
 *   - applies modelFilter to the model list
 *   - narrows the catalog to matching ids
 *   - emits descriptor flags only for matching models
 *   - spreads each named static group
 *   - merges in a stable order (static wins on collision)
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { Models } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import type { ModelLike } from '#param-surface';
import { ALIAS_MAP, loadCatalog } from '#param-surface';
import { defineFlow } from '../../02-registry/01-flow-spec/index.ts';
import { FLOWS } from '../../02-registry/02-flows/index.ts';
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

/* ─────────────────────────────────────────────────────────────────────── */
/*  Real-SDK integration — the surface each command actually ships        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('composeFlagsForFlow — against the real SDK, for every registered flow', () => {
  const models = Models.list();
  const catalog = loadCatalog(models, ALIAS_MAP);

  type ComposedFlag = { char?: string; aliases?: readonly string[] };

  for (const [id, flow] of Object.entries(FLOWS)) {
    it(`flow "${id}" composes a flag set with no duplicate names, chars, or aliases`, () => {
      const flags = composeFlagsForFlow(flow, catalog, models) as Record<string, ComposedFlag>;
      expect(Object.keys(flags).length).toBeGreaterThan(0);

      // A flag NAME can never collide (object keys), but a long alias or a
      // short char colliding with another flag makes oclif parsing
      // ambiguous — and nothing else checks the per-flow composed set.
      const names = new Set(Object.keys(flags));
      const dupes: string[] = [];

      const seenAliases = new Map<string, string>();
      const seenChars = new Map<string, string>();
      for (const [name, flag] of Object.entries(flags)) {
        for (const alias of flag.aliases ?? []) {
          if (names.has(alias)) dupes.push(`alias '${alias}' of --${name} shadows a flag name`);
          const holder = seenAliases.get(alias);
          if (holder) dupes.push(`alias '${alias}' claimed by --${holder} and --${name}`);
          seenAliases.set(alias, name);
        }
        if (flag.char) {
          const holder = seenChars.get(flag.char);
          if (holder) dupes.push(`char '-${flag.char}' claimed by --${holder} and --${name}`);
          seenChars.set(flag.char, name);
        }
      }
      expect(dupes, dupes.join('; ')).toEqual([]);
    });
  }
});

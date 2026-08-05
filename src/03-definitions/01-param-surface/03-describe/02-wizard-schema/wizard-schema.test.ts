/**
 * Wizard Schema — descriptor → declarative wizard step.
 *
 * The describe-half twin of flag-schema. Walks a Catalog, emits one
 * WizardStep per non-file surface, recurses into object descriptors.
 * Composition (pre-model picker, post-output options, etc.) is a
 * downstream block's concern.
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_BOOLEAN,
  MODEL_ENUM_NUMBER,
  MODEL_ENUM_STRING,
  MODEL_FILE,
  MODEL_OBJECT,
  MODEL_RANGE,
  MODEL_TEXT,
  type ModelLike,
} from '../../__test-utils__/models-min.ts';
import { ALIAS_MAP } from '../../01-primitives/01-aliases/index.ts';
import { loadCatalog } from '../../02-catalog/index.ts';
import { generateWizardStepsFromCatalog, type WizardStep } from './wizard-schema.ts';

function stepByKey(steps: readonly WizardStep[], key: string): WizardStep {
  const step = steps.find((s) => s.key === key);
  if (!step) throw new Error(`no step for key '${key}' — got [${steps.map((s) => s.key).join(', ')}]`);
  return step;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Empty catalog                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateWizardStepsFromCatalog — empty', () => {
  it('returns an empty array for an empty catalog', () => {
    expect(generateWizardStepsFromCatalog(loadCatalog([], ALIAS_MAP))).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Per-kind output                                                       */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateWizardStepsFromCatalog — kind table', () => {
  it('text descriptor → text step with length bounds', () => {
    const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'prompt');
    expect(step).toMatchObject({ kind: 'text', key: 'prompt', maxLength: 2000 });
  });

  it('enum<string> descriptor → select step with string choices', () => {
    const cat = loadCatalog([MODEL_ENUM_STRING], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'aspectRatio');
    if (step.kind !== 'select') throw new Error(`expected select, got ${step.kind}`);
    expect(step.choices.map((c) => c.id)).toEqual(['16:9', '9:16']);
    expect(step.default).toBe('16:9');
  });

  it('enum<number> descriptor → select step preserving numeric ids', () => {
    const cat = loadCatalog([MODEL_ENUM_NUMBER], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'duration');
    if (step.kind !== 'select') throw new Error(`expected select, got ${step.kind}`);
    expect(step.choices.map((c) => c.id)).toEqual([5, 10, 15]);
    expect(typeof step.choices[0].id).toBe('number');
    expect(step.default).toBe(5);
  });

  it('boolean descriptor → confirm step with default', () => {
    const cat = loadCatalog([MODEL_BOOLEAN], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'generateAudio');
    expect(step).toMatchObject({ kind: 'confirm', key: 'generateAudio', default: true });
  });

  it('range descriptor → number step with bounds', () => {
    const cat = loadCatalog([MODEL_RANGE], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'cfgScale');
    expect(step).toMatchObject({ kind: 'number', key: 'cfgScale', min: 1, max: 20, default: 7.5 });
  });

  it('file descriptor → file step with accept + multi flags', () => {
    const cat = loadCatalog([MODEL_FILE], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'imageUrls');
    if (step.kind !== 'file') throw new Error(`expected file, got ${step.kind}`);
    expect(step.accept).toBe('image');
    expect(step.multi).toBe(true);
    expect(step.arrayMax).toBe(4);
  });

  it('file descriptor without `array` → multi: false, no arrayMax', () => {
    const singleFile = {
      id: 'fx-single-file',
      paramConfig: {
        sourceImage: { descriptor: { kind: 'file' as const, accept: 'image' as const } },
      },
    };
    const cat = loadCatalog([singleFile as unknown as ModelLike], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'sourceImage');
    if (step.kind !== 'file') throw new Error(`expected file, got ${step.kind}`);
    expect(step.multi).toBe(false);
    expect(step.arrayMax).toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Object descriptor — recursive sub-steps                               */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateWizardStepsFromCatalog — object descriptors', () => {
  it('produces an object step with one sub-step per subfield, required-first', () => {
    // Subfields are sorted required-first so the wizard asks for the
    // meaningful fields before the filler ones. `index` has a default
    // (it's an optional position hint) so it lands at the end;
    // `prompt` and `duration` have no defaults so they come first.
    const cat = loadCatalog([MODEL_OBJECT], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'multiPrompt');
    if (step.kind !== 'object') throw new Error(`expected object, got ${step.kind}`);
    expect(step.fields.map((f) => f.key)).toEqual(['prompt', 'duration', 'index']);
  });

  it('passes through array.max as arrayMax on the object step', () => {
    const cat = loadCatalog([MODEL_OBJECT], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'multiPrompt');
    if (step.kind !== 'object') throw new Error(`expected object, got ${step.kind}`);
    expect(step.arrayMax).toBe(6);
  });

  it('subfield steps inherit the right kind from each subfield descriptor', () => {
    const cat = loadCatalog([MODEL_OBJECT], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'multiPrompt');
    if (step.kind !== 'object') throw new Error(`expected object, got ${step.kind}`);
    const byKey = (k: string): WizardStep => {
      const f = step.fields.find((x) => x.key === k);
      if (!f) throw new Error(`no subfield ${k}`);
      return f;
    };
    expect(byKey('index').kind).toBe('number');
    expect(byKey('prompt').kind).toBe('text');
    expect(byKey('duration').kind).toBe('text');
  });

  it('subfield without a default is marked required, with-default is not', () => {
    const cat = loadCatalog([MODEL_OBJECT], ALIAS_MAP);
    const step = stepByKey(generateWizardStepsFromCatalog(cat), 'multiPrompt');
    if (step.kind !== 'object') throw new Error(`expected object, got ${step.kind}`);
    expect(step.fields.find((f) => f.key === 'index')?.required).toBeFalsy();
    expect(step.fields.find((f) => f.key === 'prompt')?.required).toBe(true);
    expect(step.fields.find((f) => f.key === 'duration')?.required).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Required flag on top-level steps                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateWizardStepsFromCatalog — required flag', () => {
  it('marks a step required when any model declares the param required', () => {
    // MODEL_TEXT has `required: true` on `prompt`
    const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);
    expect(stepByKey(generateWizardStepsFromCatalog(cat), 'prompt').required).toBe(true);
  });

  it('leaves required falsy when no model requires the param', () => {
    const optionalText: ModelLike = {
      id: 'fx-optional',
      paramConfig: {
        seedHint: { descriptor: { kind: 'text' } },
      },
    };
    const cat = loadCatalog([optionalText], ALIAS_MAP);
    expect(stepByKey(generateWizardStepsFromCatalog(cat), 'seedHint').required).toBeFalsy();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Label resolution (same rule as flag-schema's description)             */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateWizardStepsFromCatalog — labels', () => {
  it('uses the first non-empty per-model label as the wizard prompt label', () => {
    // MODEL_TEXT carries label 'Prompt'
    const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);
    expect(stepByKey(generateWizardStepsFromCatalog(cat), 'prompt').label).toBe('Prompt');
  });

  it('falls back to the camelCase key when no model supplied a label', () => {
    const unlabeled: ModelLike = {
      id: 'fx-unlabeled',
      paramConfig: {
        somethingFancy: { descriptor: { kind: 'text' } },
      },
    };
    const cat = loadCatalog([unlabeled], ALIAS_MAP);
    expect(stepByKey(generateWizardStepsFromCatalog(cat), 'somethingFancy').label).toBe('somethingFancy');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Stable order (matches catalog.all() order)                            */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateWizardStepsFromCatalog — order', () => {
  it('emits one step per surface in catalog.all() order (files included)', () => {
    const cat = loadCatalog([MODEL_TEXT, MODEL_ENUM_STRING, MODEL_BOOLEAN, MODEL_FILE], ALIAS_MAP);
    const steps = generateWizardStepsFromCatalog(cat);
    expect(steps.map((s) => s.key)).toEqual(cat.all().map((s) => s.key));
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Composite — multiple kinds in one catalog                             */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateWizardStepsFromCatalog — composite', () => {
  it('emits one step per surface across mixed kinds (files included)', () => {
    const cat = loadCatalog([MODEL_TEXT, MODEL_ENUM_STRING, MODEL_BOOLEAN, MODEL_RANGE, MODEL_FILE], ALIAS_MAP);
    const keys = generateWizardStepsFromCatalog(cat)
      .map((s) => s.key)
      .sort();
    expect(keys).toEqual(['aspectRatio', 'cfgScale', 'generateAudio', 'imageUrls', 'prompt']);
  });
});

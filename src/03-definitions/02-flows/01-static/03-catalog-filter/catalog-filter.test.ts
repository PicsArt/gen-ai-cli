/**
 * Catalog Filter — produce a Catalog view scoped to a subset of models.
 *
 * Tests cover:
 *   - empty set → empty catalog
 *   - full set → equivalent catalog
 *   - partial set → only surfaces declared by matching models, with
 *     models / requiredInModels / perModelLabels / conflicts trimmed
 *   - bySdkKey and byFlag (incl. aliases) reflect the filtered view
 *   - all() returns surfaces sorted alphabetically (catalog contract)
 */
import { describe, expect, it } from 'vitest';
import type { ModelLike } from '#param-surface';
import { ALIAS_MAP, loadCatalog } from '#param-surface';
import { filterCatalog } from './catalog-filter.ts';

/* ─────────────────────────────────────────────────────────────────────── */
/*  Fixtures                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

const MODEL_A: ModelLike = {
  id: 'model-a',
  paramConfig: {
    prompt: { label: 'Prompt for A', required: true, descriptor: { kind: 'text', maxLength: 100 } },
    aspectRatio: {
      label: 'AR A',
      descriptor: {
        kind: 'enum',
        valueType: 'string',
        options: [{ id: '1:1' }, { id: '16:9' }],
        default: '1:1',
      },
    },
  },
};

const MODEL_B: ModelLike = {
  id: 'model-b',
  paramConfig: {
    prompt: { label: 'Prompt for B', descriptor: { kind: 'text', maxLength: 100 } },
    duration: {
      label: 'Duration',
      descriptor: { kind: 'enum', valueType: 'number', options: [{ id: 5 }, { id: 10 }], default: 5 },
    },
  },
};

const MODEL_C: ModelLike = {
  id: 'model-c',
  paramConfig: {
    seed: { descriptor: { kind: 'range', min: 0, max: 1000, default: 42 } },
  },
};

/* ─────────────────────────────────────────────────────────────────────── */
/*  Edge cases                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

describe('filterCatalog — edge cases', () => {
  it('empty modelIds set → empty catalog', () => {
    const cat = loadCatalog([MODEL_A, MODEL_B, MODEL_C], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set());
    expect(filtered.all()).toEqual([]);
    expect(filtered.bySdkKey.size).toBe(0);
    expect(filtered.byFlag.size).toBe(0);
  });

  it('set containing every model id → catalog with all original surfaces', () => {
    const cat = loadCatalog([MODEL_A, MODEL_B, MODEL_C], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['model-a', 'model-b', 'model-c']));
    expect(
      filtered
        .all()
        .map((s) => s.key)
        .sort(),
    ).toEqual(
      cat
        .all()
        .map((s) => s.key)
        .sort(),
    );
  });

  it('set with unknown model id is treated as empty for that id', () => {
    const cat = loadCatalog([MODEL_A], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['nope']));
    expect(filtered.all()).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Surface inclusion                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

describe('filterCatalog — surface inclusion', () => {
  it('keeps surfaces declared by ANY matching model', () => {
    const cat = loadCatalog([MODEL_A, MODEL_B, MODEL_C], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['model-a']));
    const keys = filtered
      .all()
      .map((s) => s.key)
      .sort();
    expect(keys).toEqual(['aspectRatio', 'prompt']);
  });

  it('drops surfaces declared only by non-matching models', () => {
    const cat = loadCatalog([MODEL_A, MODEL_C], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['model-a']));
    expect(filtered.bySdkKey.has('seed')).toBe(false);
  });

  it('keeps a surface when at least one of its models matches', () => {
    const cat = loadCatalog([MODEL_A, MODEL_B], ALIAS_MAP); // both declare `prompt`
    const filtered = filterCatalog(cat, new Set(['model-b']));
    expect(filtered.bySdkKey.has('prompt')).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Metadata trimming                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

describe('filterCatalog — metadata trimming on kept surfaces', () => {
  it('trims models[] to only matching ids', () => {
    const cat = loadCatalog([MODEL_A, MODEL_B], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['model-b']));
    const promptSurface = filtered.bySdkKey.get('prompt');
    expect(promptSurface?.models).toEqual(['model-b']);
  });

  it('trims requiredInModels[] to only matching ids', () => {
    // `prompt` is required in MODEL_A, not in MODEL_B
    const cat = loadCatalog([MODEL_A, MODEL_B], ALIAS_MAP);
    const promptOriginal = cat.bySdkKey.get('prompt');
    expect(promptOriginal?.requiredInModels).toContain('model-a');

    const filtered = filterCatalog(cat, new Set(['model-b']));
    const promptFiltered = filtered.bySdkKey.get('prompt');
    expect(promptFiltered?.requiredInModels).toEqual([]);
  });

  it('trims perModelLabels to only matching ids', () => {
    const cat = loadCatalog([MODEL_A, MODEL_B], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['model-a']));
    const labels = filtered.bySdkKey.get('prompt')?.perModelLabels;
    expect([...(labels?.keys() ?? [])]).toEqual(['model-a']);
    expect(labels?.get('model-a')).toBe('Prompt for A');
  });

  it('trims conflicts[] to only matching ids', () => {
    // Build a catalog with a kind conflict between two models, then
    // filter to just one — the conflict from the OTHER model must drop.
    const CONFLICT_A: ModelLike = {
      id: 'cf-a',
      paramConfig: { x: { descriptor: { kind: 'text' } } },
    };
    const CONFLICT_B: ModelLike = {
      id: 'cf-b',
      paramConfig: { x: { descriptor: { kind: 'range', min: 0, max: 1, default: 0 } } },
    };
    const cat = loadCatalog([CONFLICT_A, CONFLICT_B], ALIAS_MAP);
    expect(cat.bySdkKey.get('x')?.conflicts.length).toBeGreaterThan(0);

    const filtered = filterCatalog(cat, new Set(['cf-a']));
    expect(filtered.bySdkKey.get('x')?.conflicts).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Lookup maps                                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('filterCatalog — lookup maps', () => {
  it('byFlag resolves the primary flag name in the filtered view', () => {
    const cat = loadCatalog([MODEL_A, MODEL_C], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['model-a']));
    expect(filtered.byFlag.get('aspect-ratio')?.key).toBe('aspectRatio');
  });

  it('byFlag also resolves aliases (e.g. --ar for aspect-ratio)', () => {
    const cat = loadCatalog([MODEL_A], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['model-a']));
    expect(filtered.byFlag.get('ar')?.key).toBe('aspectRatio');
  });

  it('byFlag does NOT resolve flags for dropped surfaces', () => {
    const cat = loadCatalog([MODEL_A, MODEL_C], ALIAS_MAP); // model-c declares `seed`
    const filtered = filterCatalog(cat, new Set(['model-a']));
    expect(filtered.byFlag.has('seed')).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Descriptor re-merge — the narrowed view must not leak excluded models */
/* ─────────────────────────────────────────────────────────────────────── */

describe('filterCatalog — descriptor re-merge from allowed models only', () => {
  const ENUM_X: ModelLike = {
    id: 'enum-x',
    paramConfig: {
      aspectRatio: {
        descriptor: {
          kind: 'enum',
          valueType: 'string',
          options: [{ id: '16:9' }, { id: '9:16' }],
          default: '16:9',
        },
      },
    },
  };
  const ENUM_Y: ModelLike = {
    id: 'enum-y',
    paramConfig: {
      aspectRatio: {
        descriptor: {
          kind: 'enum',
          valueType: 'string',
          options: [{ id: '1:1' }, { id: '21:9' }],
          default: '1:1',
        },
      },
    },
  };

  it('drops enum options contributed only by excluded models', () => {
    const cat = loadCatalog([ENUM_X, ENUM_Y], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['enum-y']));
    const surface = filtered.bySdkKey.get('aspectRatio');
    if (surface?.descriptor.kind !== 'enum') throw new Error('expected enum');
    expect(surface.descriptor.options.map((o) => o.id)).toEqual(['1:1', '21:9']);
    expect(surface.descriptor.default).toBe('1:1');
  });

  it('re-picks the primary kind when the first-seen model is excluded', () => {
    const TEXTY: ModelLike = { id: 'texty', paramConfig: { overlap: { descriptor: { kind: 'text' } } } };
    const RANGY: ModelLike = {
      id: 'rangy',
      paramConfig: { overlap: { descriptor: { kind: 'range', min: 0, max: 1, default: 0.5 } } },
    };
    const cat = loadCatalog([TEXTY, RANGY], ALIAS_MAP);
    // Universal view: text wins (first seen), range recorded as conflict.
    expect(cat.bySdkKey.get('overlap')?.descriptor.kind).toBe('text');

    // Narrowed to the range-only model, the flow must see a RANGE flag —
    // not the excluded text model's descriptor.
    const filtered = filterCatalog(cat, new Set(['rangy']));
    const surface = filtered.bySdkKey.get('overlap');
    expect(surface?.descriptor.kind).toBe('range');
    expect(surface?.conflicts).toEqual([]);
  });

  it('keeps the merged view intact when every declaring model is allowed', () => {
    const cat = loadCatalog([ENUM_X, ENUM_Y], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['enum-x', 'enum-y']));
    const surface = filtered.bySdkKey.get('aspectRatio');
    if (surface?.descriptor.kind !== 'enum') throw new Error('expected enum');
    expect(surface.descriptor.options.map((o) => o.id)).toEqual(['16:9', '9:16', '1:1', '21:9']);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Ordering contract                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

describe('filterCatalog — ordering', () => {
  it('all() returns surfaces sorted alphabetically by key (matches Catalog contract)', () => {
    const cat = loadCatalog([MODEL_A, MODEL_B], ALIAS_MAP);
    const filtered = filterCatalog(cat, new Set(['model-a', 'model-b']));
    const keys = filtered.all().map((s) => s.key);
    expect(keys).toEqual([...keys].sort());
  });
});

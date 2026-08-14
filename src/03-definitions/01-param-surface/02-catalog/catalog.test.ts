/**
 * Block 3 — Catalog.
 *
 * Tests in three layers:
 *   1. Pure function (`loadCatalog`) against hand-built fixtures — exercises
 *      dedup, option merge, conflict detection, alias resolution, required
 *      tracking, per-model labels.
 *   2. Real-SDK integration — verifies every entry in ALIAS_MAP points to a
 *      real descriptor key (the assertion Block 1 deferred).
 *   3. Snapshot — locks the rendered surface against SDK changes. A future
 *      SDK addition appears as a snapshot diff in CI.
 */
import { Models } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import {
  MODEL_BOOLEAN,
  MODEL_CONFLICT_RANGE,
  MODEL_CONFLICT_TEXT,
  MODEL_DEDUP_A,
  MODEL_DEDUP_B,
  MODEL_ENUM_STRING,
  MODEL_FILE,
  MODEL_OBJECT,
  MODEL_RANGE,
  MODEL_TEXT,
  type ModelLike,
} from '../__test-utils__/models-min.ts';
import { ALIAS_MAP, EXPECTED_SDK_GAPS } from '../01-primitives/01-aliases/index.ts';
import { getCatalog, loadCatalog, ParamConflictError } from './catalog.ts';

/* ─────────────────────────────────────────────────────────────────────── */
/*  Basic surface                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCatalog — basic surface', () => {
  it('produces one ParamSurface per unique descriptor key', () => {
    const cat = loadCatalog([MODEL_ENUM_STRING, MODEL_BOOLEAN, MODEL_RANGE], ALIAS_MAP);
    expect(cat.bySdkKey.size).toBe(3);
    expect(cat.bySdkKey.has('aspectRatio')).toBe(true);
    expect(cat.bySdkKey.has('generateAudio')).toBe(true);
    expect(cat.bySdkKey.has('cfgScale')).toBe(true);
  });

  it('byFlag mirrors bySdkKey via the resolved flag name', () => {
    const cat = loadCatalog([MODEL_ENUM_STRING], ALIAS_MAP);
    const surface = cat.bySdkKey.get('aspectRatio');
    expect(surface).toBeDefined();
    expect(surface?.flag).toBe('aspect-ratio');
    expect(cat.byFlag.get('aspect-ratio')).toBe(surface);
  });

  it('all() returns surfaces sorted alphabetically by key', () => {
    const cat = loadCatalog([MODEL_RANGE, MODEL_TEXT, MODEL_BOOLEAN], ALIAS_MAP);
    const keys = cat.all().map((s) => s.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('an empty model list produces an empty catalog', () => {
    const cat = loadCatalog([], ALIAS_MAP);
    expect(cat.bySdkKey.size).toBe(0);
    expect(cat.byFlag.size).toBe(0);
    expect(cat.all()).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Alias resolution                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCatalog — alias resolution', () => {
  it('applies char from ALIAS_MAP', () => {
    const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);
    expect(cat.bySdkKey.get('prompt')?.char).toBe('p');
  });

  it('applies flag override from ALIAS_MAP', () => {
    const cat = loadCatalog([MODEL_FILE], ALIAS_MAP);
    const surface = cat.bySdkKey.get('imageUrls');
    expect(surface?.flag).toBe('image');
    expect(surface?.char).toBe('i');
    expect(cat.byFlag.get('image')).toBe(surface);
    // Default kebab-case name is no longer registered when overridden.
    expect(cat.byFlag.has('image-urls')).toBe(false);
  });

  it('applies long-form aliases from ALIAS_MAP and registers them in byFlag', () => {
    const cat = loadCatalog([MODEL_ENUM_STRING], ALIAS_MAP);
    const surface = cat.bySdkKey.get('aspectRatio');
    expect(surface?.flagAliases).toContain('ar');
    expect(cat.byFlag.get('ar')).toBe(surface);
    // Default name still resolves alongside the alias.
    expect(cat.byFlag.get('aspect-ratio')).toBe(surface);
  });

  it('falls back to camelToKebab when no alias entry exists for the key', () => {
    const noAliasModel: ModelLike = {
      id: 'fx-no-alias',
      paramConfig: { wholeNewField: { descriptor: { kind: 'text' } } },
    };
    const cat = loadCatalog([noAliasModel], ALIAS_MAP);
    const surface = cat.bySdkKey.get('wholeNewField');
    expect(surface?.flag).toBe('whole-new-field');
    expect(surface?.char).toBeUndefined();
    expect(surface?.flagAliases).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Flag-name collisions                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCatalog — flag-name collisions', () => {
  // Reproduces the SDK-5 drift where a real `format` key landed next to
  // the historic `outputFormat → --format` alias: the alias must yield,
  // never shadow or misroute the real flag.
  const REAL_KEY_PLUS_ALIAS: readonly ModelLike[] = [
    { id: 'fx-real-format', paramConfig: { format: { descriptor: { kind: 'text' } } } },
    { id: 'fx-output-format', paramConfig: { outputFormat: { descriptor: { kind: 'text' } } } },
  ];
  const aliasMap = { outputFormat: { aliases: ['format'] } };

  it('a long-form alias colliding with another surface PRIMARY flag is dropped', () => {
    const cat = loadCatalog(REAL_KEY_PLUS_ALIAS, aliasMap);
    expect(cat.bySdkKey.get('outputFormat')?.flagAliases).toEqual([]);
    expect(cat.byFlag.get('format')?.key).toBe('format');
    expect(cat.byFlag.get('output-format')?.key).toBe('outputFormat');
  });

  it('alias drop is independent of model walk order', () => {
    const cat = loadCatalog([...REAL_KEY_PLUS_ALIAS].reverse(), aliasMap);
    expect(cat.bySdkKey.get('outputFormat')?.flagAliases).toEqual([]);
    expect(cat.byFlag.get('format')?.key).toBe('format');
  });

  it('two aliases claiming the same name: first surface (by key order) keeps it', () => {
    const models: readonly ModelLike[] = [
      { id: 'm1', paramConfig: { alpha: { descriptor: { kind: 'text' } } } },
      { id: 'm2', paramConfig: { beta: { descriptor: { kind: 'text' } } } },
    ];
    const cat = loadCatalog(models, { alpha: { aliases: ['x'] }, beta: { aliases: ['x'] } });
    expect(cat.byFlag.get('x')?.key).toBe('alpha');
    expect(cat.bySdkKey.get('beta')?.flagAliases).toEqual([]);
  });

  it('two keys resolving to the same PRIMARY flag throw (configuration error)', () => {
    const models: readonly ModelLike[] = [
      { id: 'm1', paramConfig: { modelVersion: { descriptor: { kind: 'text' } } } },
      { id: 'm2', paramConfig: { model: { descriptor: { kind: 'text' } } } },
    ];
    // ALIAS_MAP maps `model` → 'model-version', which `modelVersion` derives naturally.
    expect(() => loadCatalog(models, ALIAS_MAP)).toThrow(/model-version/);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Dedup                                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCatalog — dedup', () => {
  it('merges two models declaring the same key + same kind', () => {
    const cat = loadCatalog([MODEL_DEDUP_A, MODEL_DEDUP_B], ALIAS_MAP);
    expect(cat.bySdkKey.size).toBe(1);
    const surface = cat.bySdkKey.get('aspectRatio');
    expect(surface).toBeDefined();
    expect(surface?.models).toEqual(['fx-dedup-a', 'fx-dedup-b']);
  });

  it('unions enum options across merged models without duplicates', () => {
    const cat = loadCatalog([MODEL_DEDUP_A, MODEL_DEDUP_B], ALIAS_MAP);
    const surface = cat.bySdkKey.get('aspectRatio');
    if (surface?.descriptor.kind !== 'enum') {
      throw new Error('expected enum descriptor');
    }
    const ids = surface.descriptor.options.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(['16:9', '9:16', '1:1', '21:9']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('preserves the first descriptor when same kind has no mergeable fields', () => {
    const a: ModelLike = {
      id: 'fx-text-a',
      paramConfig: { prompt: { descriptor: { kind: 'text', maxLength: 100 } } },
    };
    const b: ModelLike = {
      id: 'fx-text-b',
      paramConfig: { prompt: { descriptor: { kind: 'text', maxLength: 500 } } },
    };
    const cat = loadCatalog([a, b], ALIAS_MAP);
    const surface = cat.bySdkKey.get('prompt');
    expect(surface?.models).toEqual(['fx-text-a', 'fx-text-b']);
    if (surface?.descriptor.kind !== 'text') throw new Error('expected text');
    // First model wins — Block 3 doesn't try to reconcile text constraints.
    expect(surface.descriptor.maxLength).toBe(100);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Kind conflict — permissive (default)                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCatalog — kind conflict (permissive)', () => {
  it('does NOT throw; first-seen descriptor wins, divergence is recorded', () => {
    const cat = loadCatalog([MODEL_CONFLICT_TEXT, MODEL_CONFLICT_RANGE], ALIAS_MAP);
    const surface = cat.bySdkKey.get('overlap');
    expect(surface).toBeDefined();
    expect(surface?.descriptor.kind).toBe('text');
    expect(surface?.models).toEqual(['fx-conflict-text', 'fx-conflict-range']);
  });

  it('records the conflicting model on `conflicts`', () => {
    const cat = loadCatalog([MODEL_CONFLICT_TEXT, MODEL_CONFLICT_RANGE], ALIAS_MAP);
    const surface = cat.bySdkKey.get('overlap');
    expect(surface?.conflicts).toHaveLength(1);
    expect(surface?.conflicts[0].modelId).toBe('fx-conflict-range');
    expect(surface?.conflicts[0].kind).toBe('range');
    expect(surface?.conflicts[0].descriptor.kind).toBe('range');
  });

  it('records same-kind enum-valueType mismatches as conflicts', () => {
    const a: ModelLike = {
      id: 'fx-enum-mismatch-string',
      paramConfig: {
        x: { descriptor: { kind: 'enum', valueType: 'string', options: [{ id: 'a' }], default: 'a' } },
      },
    };
    const b: ModelLike = {
      id: 'fx-enum-mismatch-number',
      paramConfig: {
        x: { descriptor: { kind: 'enum', valueType: 'number', options: [{ id: 1 }], default: 1 } },
      },
    };
    const cat = loadCatalog([a, b], ALIAS_MAP);
    const surface = cat.bySdkKey.get('x');
    expect(surface?.conflicts).toHaveLength(1);
    expect(surface?.conflicts[0].kind).toBe('enum:number');
  });

  it('non-conflicting surfaces have an empty conflicts array', () => {
    const cat = loadCatalog([MODEL_TEXT, MODEL_RANGE], ALIAS_MAP);
    expect(cat.bySdkKey.get('prompt')?.conflicts).toEqual([]);
    expect(cat.bySdkKey.get('cfgScale')?.conflicts).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Kind conflict — strict mode                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCatalog — kind conflict (strict)', () => {
  it('throws ParamConflictError when strict and a conflict occurs', () => {
    expect(() => loadCatalog([MODEL_CONFLICT_TEXT, MODEL_CONFLICT_RANGE], ALIAS_MAP, { strict: true })).toThrow(
      ParamConflictError,
    );
  });

  it('error message cites the conflicting key + each model id + each kind', () => {
    try {
      loadCatalog([MODEL_CONFLICT_TEXT, MODEL_CONFLICT_RANGE], ALIAS_MAP, { strict: true });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('overlap');
      expect(msg).toContain('fx-conflict-text');
      expect(msg).toContain('fx-conflict-range');
      expect(msg).toContain('text');
      expect(msg).toContain('range');
    }
  });

  it('ParamConflictError exposes the key and the conflicting model ids', () => {
    try {
      loadCatalog([MODEL_CONFLICT_TEXT, MODEL_CONFLICT_RANGE], ALIAS_MAP, { strict: true });
    } catch (e) {
      const err = e as ParamConflictError;
      expect(err.key).toBe('overlap');
      expect(err.modelIds).toEqual(['fx-conflict-text', 'fx-conflict-range']);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Required-ness tracking                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCatalog — required tracking', () => {
  it('records only the models that declared the key as required', () => {
    const required: ModelLike = {
      id: 'fx-required',
      paramConfig: { prompt: { required: true, descriptor: { kind: 'text' } } },
    };
    const optional: ModelLike = {
      id: 'fx-optional',
      paramConfig: { prompt: { required: false, descriptor: { kind: 'text' } } },
    };
    const cat = loadCatalog([required, optional], ALIAS_MAP);
    const surface = cat.bySdkKey.get('prompt');
    expect(surface?.requiredInModels).toEqual(['fx-required']);
    expect(surface?.models).toEqual(['fx-required', 'fx-optional']);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Per-model labels                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCatalog — per-model labels', () => {
  it('captures different labels for the same key across models', () => {
    const a: ModelLike = {
      id: 'fx-label-a',
      paramConfig: { prompt: { label: 'Prompt', descriptor: { kind: 'text' } } },
    };
    const b: ModelLike = {
      id: 'fx-label-b',
      paramConfig: { prompt: { label: 'Caption', descriptor: { kind: 'text' } } },
    };
    const cat = loadCatalog([a, b], ALIAS_MAP);
    const surface = cat.bySdkKey.get('prompt');
    expect(surface?.perModelLabels.get('fx-label-a')).toBe('Prompt');
    expect(surface?.perModelLabels.get('fx-label-b')).toBe('Caption');
  });

  it('omits models that did not provide a label', () => {
    const a: ModelLike = {
      id: 'fx-with-label',
      paramConfig: { prompt: { label: 'Prompt', descriptor: { kind: 'text' } } },
    };
    const b: ModelLike = {
      id: 'fx-no-label',
      paramConfig: { prompt: { descriptor: { kind: 'text' } } },
    };
    const cat = loadCatalog([a, b], ALIAS_MAP);
    const labels = cat.bySdkKey.get('prompt')?.perModelLabels;
    expect(labels?.size).toBe(1);
    expect(labels?.has('fx-with-label')).toBe(true);
    expect(labels?.has('fx-no-label')).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Object descriptor pass-through                                        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadCatalog — object descriptor', () => {
  it('does not throw and exposes the descriptor as-is for Block 4 to consume', () => {
    const cat = loadCatalog([MODEL_OBJECT], ALIAS_MAP);
    const surface = cat.bySdkKey.get('multiPrompt');
    expect(surface?.descriptor.kind).toBe('object');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Real-SDK integration                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('against the real SDK catalog', () => {
  const realCatalog = loadCatalog(Models.list(), ALIAS_MAP);

  // The exemption list lives next to ALIAS_MAP (single source of truth,
  // also consumed by `gen-ai dev:params`). See EXPECTED_SDK_GAPS in
  // 01-primitives/01-aliases/aliases.ts for what qualifies as a gap.

  it('every non-exempt ALIAS_MAP key maps to a real SDK descriptor', () => {
    const orphans: string[] = [];
    for (const key of Object.keys(ALIAS_MAP)) {
      if (EXPECTED_SDK_GAPS.has(key)) continue;
      if (!realCatalog.bySdkKey.has(key)) orphans.push(key);
    }
    expect(orphans, `Unexpected orphan aliases: ${orphans.join(', ')}`).toEqual([]);
  });

  it('the EXPECTED_SDK_GAPS exemption list itself does not grow stale', () => {
    // If a previously-exempt key now appears in the SDK catalog (the SDK
    // closed the gap), the exemption is no longer needed and should be
    // removed. This test catches the situation.
    const closedGaps: string[] = [];
    for (const key of EXPECTED_SDK_GAPS) {
      if (realCatalog.bySdkKey.has(key)) closedGaps.push(key);
    }
    expect(closedGaps, `SDK closed these gaps — remove from EXPECTED_SDK_GAPS: ${closedGaps.join(', ')}`).toEqual([]);
  });

  it('exposes a non-empty catalog', () => {
    expect(realCatalog.bySdkKey.size).toBeGreaterThan(0);
  });

  it('no two surfaces share a flag name or alias (silent byFlag overwrites)', () => {
    // Guards against SDK drift like the 5.0.0 `format` / `thinking` keys
    // landing next to the historic `outputFormat → --format` /
    // `thinkingLevel → --thinking` aliases.
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const s of realCatalog.all()) {
      for (const name of [s.flag, ...s.flagAliases]) {
        const holder = seen.get(name);
        if (holder !== undefined) dupes.push(`--${name} claimed by both '${holder}' and '${s.key}'`);
        else seen.set(name, s.key);
      }
    }
    expect(dupes, dupes.join('; ')).toEqual([]);
  });

  it('produces a stable surface (snapshot)', () => {
    const serialized = realCatalog.all().map((s) => ({
      key: s.key,
      flag: s.flag,
      char: s.char ?? null,
      flagAliases: [...s.flagAliases],
      kind: s.descriptor.kind,
      valueType: s.descriptor.kind === 'enum' ? s.descriptor.valueType : null,
      optionCount: s.descriptor.kind === 'enum' ? s.descriptor.options.length : null,
      modelCount: s.models.length,
      requiredCount: s.requiredInModels.length,
    }));
    expect(serialized).toMatchSnapshot();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Module-scope singleton                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getCatalog', () => {
  it('returns the same instance on repeated calls', () => {
    expect(getCatalog()).toBe(getCatalog());
  });
});

/**
 * Wizard Reader — answers → ctx.
 *
 * The interpret-half twin of wizard-schema. Tests cover:
 *   - one section per descriptor kind (happy paths)
 *   - file descriptors skipped
 *   - object descriptors expect an array of items; each subfield value
 *     is coerced through primitives/coercion
 *   - subfield default backfill + missing-required error parity with
 *     the flag-reader's object handling
 *   - keys map by `surface.key` (camelCase), not `surface.flag` (kebab)
 *   - flags-style noise keys in the answers object are silently ignored
 */
import { describe, expect, it } from 'vitest';
import { UsageError } from '#infra/errors/usage.ts';
import {
  MODEL_BOOLEAN,
  MODEL_CATALOG,
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
import { collectContextFromAnswers } from './wizard-reader.ts';

/* ─────────────────────────────────────────────────────────────────────── */
/*  Empty                                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectContextFromAnswers — empty', () => {
  it('returns an empty ctx when answers is empty', () => {
    const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);
    expect(collectContextFromAnswers({}, cat)).toEqual({});
  });

  it('returns an empty ctx for an empty catalog', () => {
    const cat = loadCatalog([], ALIAS_MAP);
    expect(collectContextFromAnswers({ prompt: 'hi' }, cat)).toEqual({});
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Per-kind                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectContextFromAnswers — kind table', () => {
  it('text answer lands in ctx under the camelCase key', () => {
    const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);
    expect(collectContextFromAnswers({ prompt: 'a sunset' }, cat)).toEqual({ prompt: 'a sunset' });
  });

  it('enum<string> answer is validated against options and passes through', () => {
    const cat = loadCatalog([MODEL_ENUM_STRING], ALIAS_MAP);
    expect(collectContextFromAnswers({ aspectRatio: '16:9' }, cat)).toEqual({ aspectRatio: '16:9' });
  });

  it('enum<number> answer arrives already numeric and stays numeric', () => {
    const cat = loadCatalog([MODEL_ENUM_NUMBER], ALIAS_MAP);
    const ctx = collectContextFromAnswers({ duration: 10 }, cat);
    expect(ctx).toEqual({ duration: 10 });
    expect(typeof (ctx as { duration: unknown }).duration).toBe('number');
  });

  it('enum<number> also accepts the numeric value as a string (parses + revalidates)', () => {
    const cat = loadCatalog([MODEL_ENUM_NUMBER], ALIAS_MAP);
    expect(collectContextFromAnswers({ duration: '10' }, cat)).toEqual({ duration: 10 });
  });

  it('boolean answer passes through', () => {
    const cat = loadCatalog([MODEL_BOOLEAN], ALIAS_MAP);
    expect(collectContextFromAnswers({ generateAudio: false }, cat)).toEqual({ generateAudio: false });
  });

  it('range answer is bounded-checked', () => {
    const cat = loadCatalog([MODEL_RANGE], ALIAS_MAP);
    expect(collectContextFromAnswers({ cfgScale: 7.5 }, cat)).toEqual({ cfgScale: 7.5 });
    expect(() => collectContextFromAnswers({ cfgScale: 999 }, cat)).toThrow(UsageError);
  });

  it('text answer respects maxLength', () => {
    const cat = loadCatalog(
      [{ id: 'm', paramConfig: { foo: { descriptor: { kind: 'text', maxLength: 3 } } } } as ModelLike],
      ALIAS_MAP,
    );
    expect(() => collectContextFromAnswers({ foo: 'toolong' }, cat)).toThrow(UsageError);
  });

  it('file descriptors are not read into ctx (file pipeline owns these)', () => {
    const cat = loadCatalog([MODEL_FILE], ALIAS_MAP);
    expect(collectContextFromAnswers({ imageUrls: 'will-be-ignored' }, cat)).toEqual({});
  });

  it('catalog answer (free-string id) passes through under the SDK key', () => {
    const cat = loadCatalog([MODEL_CATALOG], ALIAS_MAP);
    expect(collectContextFromAnswers({ voiceId: 'vx_123' }, cat)).toEqual({ voiceId: 'vx_123' });
  });

  it('catalog answer of a non-string type throws UsageError', () => {
    const cat = loadCatalog([MODEL_CATALOG], ALIAS_MAP);
    expect(() => collectContextFromAnswers({ voiceId: 42 }, cat)).toThrow(UsageError);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Missing keys                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectContextFromAnswers — undefined values', () => {
  it('omits keys whose answer is undefined', () => {
    const cat = loadCatalog([MODEL_TEXT, MODEL_BOOLEAN], ALIAS_MAP);
    const ctx = collectContextFromAnswers({ prompt: 'a sunset' }, cat);
    expect(ctx).toEqual({ prompt: 'a sunset' });
    expect('generateAudio' in ctx).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Key shape (camelCase, not kebab)                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectContextFromAnswers — key shape', () => {
  it('reads from the camelCase surface.key, not the kebab flag name', () => {
    const cat = loadCatalog([MODEL_ENUM_STRING], ALIAS_MAP);
    // user provides under camelCase key — that's what wizard-schema's WizardStep.key uses
    expect(collectContextFromAnswers({ aspectRatio: '16:9' }, cat)).toEqual({ aspectRatio: '16:9' });
    // providing under the kebab flag name is treated as noise
    expect(collectContextFromAnswers({ 'aspect-ratio': '16:9' }, cat)).toEqual({});
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Object descriptors                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectContextFromAnswers — object descriptors', () => {
  const objectCat = () => loadCatalog([MODEL_OBJECT], ALIAS_MAP);

  it('accepts an array of items and coerces each subfield value', () => {
    const ctx = collectContextFromAnswers(
      {
        multiPrompt: [
          { index: 0, prompt: 'a', duration: '5' },
          { index: 1, prompt: 'b', duration: '7' },
        ],
      },
      objectCat(),
    );
    expect(ctx).toEqual({
      multiPrompt: [
        { index: 0, prompt: 'a', duration: '5' },
        { index: 1, prompt: 'b', duration: '7' },
      ],
    });
  });

  it('coerces string subfield values to typed (e.g. range subfield)', () => {
    const ctx = collectContextFromAnswers({ multiPrompt: [{ index: '3', prompt: 'a', duration: '5' }] }, objectCat());
    expect(ctx).toEqual({ multiPrompt: [{ index: 3, prompt: 'a', duration: '5' }] });
  });

  it('backfills missing subfields from their descriptor defaults; `index` is auto-numbered 1..N', () => {
    const ctx = collectContextFromAnswers(
      { multiPrompt: [{ prompt: 'a', duration: '5' }] }, // index omitted
      objectCat(),
    );
    // `index` is a special subfield — when no non-zero caller value is
    // present, autoNumberIndexField positions it 1..N so vendors that
    // require 1-based consecutive indices (Kling V3 multi-shot) accept
    // the payload. Other subfields still use descriptor defaults.
    expect(ctx).toEqual({ multiPrompt: [{ index: 1, prompt: 'a', duration: '5' }] });
  });

  it('throws UsageError when a subfield without default is missing', () => {
    expect(() => collectContextFromAnswers({ multiPrompt: [{ index: 0, duration: '5' }] }, objectCat())).toThrow(
      UsageError,
    );
  });

  it('returns undefined for the key (omitting from ctx) when answer array is empty', () => {
    const ctx = collectContextFromAnswers({ multiPrompt: [] }, objectCat());
    expect('multiPrompt' in ctx).toBe(false);
  });

  it('throws when the answer is not an array', () => {
    expect(() => collectContextFromAnswers({ multiPrompt: 'oops' }, objectCat())).toThrow();
  });

  it('throws when item count exceeds array.max', () => {
    const items = new Array(7).fill({ prompt: 'p', duration: '5' });
    expect(() => collectContextFromAnswers({ multiPrompt: items }, objectCat())).toThrow(UsageError);
  });

  it('bubbles up coercion errors from subfield validators', () => {
    expect(() =>
      collectContextFromAnswers({ multiPrompt: [{ index: 99, prompt: 'a', duration: '5' }] }, objectCat()),
    ).toThrow(UsageError);
  });

  it('single-field object also accepts an array of items', () => {
    const cat = loadCatalog(
      [
        {
          id: 'm',
          paramConfig: {
            voiceList: { descriptor: { kind: 'object', array: { max: 2 }, fields: { voice_id: { kind: 'text' } } } },
          },
        } as ModelLike,
      ],
      ALIAS_MAP,
    );
    expect(collectContextFromAnswers({ voiceList: [{ voice_id: 'vx_1' }, { voice_id: 'vx_2' }] }, cat)).toEqual({
      voiceList: [{ voice_id: 'vx_1' }, { voice_id: 'vx_2' }],
    });
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Noise keys are ignored                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectContextFromAnswers — noise', () => {
  it('ignores answer keys that have no surface in the catalog', () => {
    const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);
    const ctx = collectContextFromAnswers({ prompt: 'hi', __runnerMeta: 'whatever', _step: 3 }, cat);
    expect(ctx).toEqual({ prompt: 'hi' });
  });

  it("ignores composer-owned '$'-prefixed keys ($model from the wizard model picker)", () => {
    // The wizard composer keys its model picker as '$model' so it can
    // never collide with the real SDK `model` descriptor key. The reader
    // must leave it to the runner, even when a `model` surface exists.
    const withModelKey = loadCatalog(
      [{ id: 'm', paramConfig: { model: { descriptor: { kind: 'text' } } } } as ModelLike],
      ALIAS_MAP,
    );
    const ctx = collectContextFromAnswers({ $model: 'kling-v3', model: 'High Fidelity V2' }, withModelKey);
    expect(ctx).toEqual({ model: 'High Fidelity V2' });
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Composite                                                             */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectContextFromAnswers — composite', () => {
  it('mixes scalar, boolean, enum<number>, and object into one ctx', () => {
    const cat = loadCatalog([MODEL_TEXT, MODEL_BOOLEAN, MODEL_ENUM_NUMBER, MODEL_OBJECT], ALIAS_MAP);
    const ctx = collectContextFromAnswers(
      {
        prompt: 'a sunset',
        generateAudio: true,
        duration: 10,
        multiPrompt: [{ prompt: 'wide', duration: '5' }],
      },
      cat,
    );
    expect(ctx).toEqual({
      prompt: 'a sunset',
      generateAudio: true,
      duration: 10,
      multiPrompt: [{ index: 1, prompt: 'wide', duration: '5' }],
    });
  });
});

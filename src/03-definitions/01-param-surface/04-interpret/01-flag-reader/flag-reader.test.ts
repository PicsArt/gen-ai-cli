/**
 * Block 6 — Value Collector.
 *
 * The inverse of Block 5: given parsed flag values (from oclif) and a
 * Catalog, produce the typed generation context the SDK's buildPayload
 * expects.
 *
 * Tests cover:
 *   - one section per descriptor kind (happy paths)
 *   - file descriptors are skipped (resolver's file pipeline handles them)
 *   - object descriptors delegate to Block 4
 *   - coercion errors bubble up from Block 2
 *   - flags not in the catalog are ignored
 *   - aliases / chars resolved by oclif don't need extra handling
 */
import type { ModelParams } from '@picsart/ai-sdk';
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
import { collectGenerationContext } from './flag-reader.ts';

/* ─────────────────────────────────────────────────────────────────────── */
/*  Empty                                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectGenerationContext — empty inputs', () => {
  it('returns an empty ctx when no flags are set', () => {
    const cat = loadCatalog([MODEL_TEXT, MODEL_BOOLEAN], ALIAS_MAP);
    expect(collectGenerationContext({}, cat)).toEqual({});
  });

  it('returns an empty ctx from an empty catalog', () => {
    const cat = loadCatalog([], ALIAS_MAP);
    expect(collectGenerationContext({ anything: 'value' }, cat)).toEqual({});
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Scalar kinds                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectGenerationContext — enum<string>', () => {
  const cat = loadCatalog([MODEL_ENUM_STRING], ALIAS_MAP);

  it('writes the value to the camelCase ctx key', () => {
    const ctx = collectGenerationContext({ 'aspect-ratio': '16:9' }, cat);
    expect(ctx).toEqual({ aspectRatio: '16:9' });
  });

  it('omits the key when the flag was not set', () => {
    expect(collectGenerationContext({}, cat)).toEqual({});
  });
});

describe('collectGenerationContext — enum<number>', () => {
  const cat = loadCatalog([MODEL_ENUM_NUMBER], ALIAS_MAP);

  it('coerces numeric-string to number', () => {
    const ctx = collectGenerationContext({ duration: '10' }, cat);
    expect(ctx).toEqual({ duration: 10 });
  });
});

describe('collectGenerationContext — boolean', () => {
  const cat = loadCatalog([MODEL_BOOLEAN], ALIAS_MAP);

  it('passes through a boolean value', () => {
    const ctx = collectGenerationContext({ 'generate-audio': true }, cat);
    expect(ctx).toEqual({ generateAudio: true });
  });

  it('passes through false correctly', () => {
    const ctx = collectGenerationContext({ 'generate-audio': false }, cat);
    expect(ctx).toEqual({ generateAudio: false });
  });
});

describe('collectGenerationContext — range', () => {
  const cat = loadCatalog([MODEL_RANGE], ALIAS_MAP);

  it('parses a numeric-string and validates bounds', () => {
    const ctx = collectGenerationContext({ 'cfg-scale': '7.5' }, cat);
    expect(ctx).toEqual({ cfgScale: 7.5 });
  });

  it('out-of-bounds throws UsageError (bubbled from Block 2)', () => {
    expect(() => collectGenerationContext({ 'cfg-scale': '999' }, cat)).toThrow(UsageError);
  });
});

describe('collectGenerationContext — text', () => {
  const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);

  it('passes a string straight through', () => {
    const ctx = collectGenerationContext({ prompt: 'hello world' }, cat);
    expect(ctx).toEqual({ prompt: 'hello world' });
  });

  it('maxLength violations throw UsageError', () => {
    // MODEL_TEXT has maxLength 2000; build a 2001-char string
    const tooLong = 'x'.repeat(2001);
    expect(() => collectGenerationContext({ prompt: tooLong }, cat)).toThrow(UsageError);
  });
});

describe('collectGenerationContext — catalog', () => {
  const cat = loadCatalog([MODEL_CATALOG], ALIAS_MAP);

  it('reads the aliased flag (--voice) into the SDK key (voiceId)', () => {
    const ctx = collectGenerationContext({ voice: 'vx_123' }, cat);
    expect(ctx).toEqual({ voiceId: 'vx_123' });
  });

  it('non-string values throw UsageError (bubbled from Block 2)', () => {
    expect(() => collectGenerationContext({ voice: 42 }, cat)).toThrow(UsageError);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  File — skipped                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectGenerationContext — file (skipped)', () => {
  const cat = loadCatalog([MODEL_FILE], ALIAS_MAP);

  it('does NOT write file-descriptor flag values to ctx', () => {
    // The resolver's file pipeline handles --image. If a value somehow lands
    // in flags['image'], Block 6 must not put it into ctx.imageUrls.
    const ctx = collectGenerationContext({ image: ['./photo.jpg'] }, cat);
    expect(ctx).toEqual({});
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Object descriptors                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectGenerationContext — object descriptors', () => {
  const cat = loadCatalog([MODEL_OBJECT], ALIAS_MAP);

  it('delegates multi-field object collection to Block 4', () => {
    const ctx = collectGenerationContext(
      {
        'multi-prompt-prompt': ['wide shot', 'close-up'],
        'multi-prompt-duration': ['5', '7'],
      },
      cat,
    );
    expect(ctx).toEqual({
      multiPrompt: [
        { index: 1, prompt: 'wide shot', duration: '5' },
        { index: 2, prompt: 'close-up', duration: '7' },
      ],
    });
  });

  it('omits the key when no subfield flag was passed', () => {
    expect(collectGenerationContext({}, cat)).toEqual({});
  });

  it('bubbles up object-collector errors (missing required subfield)', () => {
    expect(() =>
      collectGenerationContext(
        {
          'multi-prompt-prompt': ['a', 'b'],
          'multi-prompt-duration': ['5'], // missing duration[1] — no default → throw
        },
        cat,
      ),
    ).toThrow(UsageError);
  });

  it('handles a single-field object descriptor (one repeatable flag)', () => {
    const singleField: ModelLike = {
      id: 'fx-single-field-object',
      paramConfig: {
        elementList: {
          descriptor: {
            kind: 'object',
            array: { max: 4 },
            fields: { element_id: { kind: 'text' } },
          },
        },
      } satisfies ModelParams,
    };
    const c = loadCatalog([singleField], ALIAS_MAP);
    const ctx = collectGenerationContext({ 'element-list': ['el_1', 'el_2'] }, c);
    expect(ctx).toEqual({
      elementList: [{ element_id: 'el_1' }, { element_id: 'el_2' }],
    });
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Mixed catalog                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectGenerationContext — mixed catalog', () => {
  const cat = loadCatalog(
    [MODEL_ENUM_STRING, MODEL_ENUM_NUMBER, MODEL_BOOLEAN, MODEL_RANGE, MODEL_TEXT, MODEL_FILE, MODEL_OBJECT],
    ALIAS_MAP,
  );

  it('collects every set flag, skips unset and file kinds', () => {
    const ctx = collectGenerationContext(
      {
        'aspect-ratio': '16:9',
        duration: '10',
        'generate-audio': true,
        'cfg-scale': '5',
        prompt: 'a landscape',
        // file (image) ignored even if passed
        image: ['./local.jpg'],
        // object: multi-prompt skipped (no subfield flag passed)
      },
      cat,
    );
    expect(ctx).toEqual({
      aspectRatio: '16:9',
      duration: 10,
      generateAudio: true,
      cfgScale: 5,
      prompt: 'a landscape',
    });
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Unknown flags                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectGenerationContext — flags not in the catalog', () => {
  const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);

  it('silently ignores flags the catalog does not declare', () => {
    // --json / --quiet / etc. (universal flags) live outside the catalog.
    // Block 6 must NOT crash or put them in ctx.
    const ctx = collectGenerationContext(
      {
        prompt: 'hello',
        json: true,
        quiet: false,
        'totally-made-up': 'value',
      },
      cat,
    );
    expect(ctx).toEqual({ prompt: 'hello' });
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Alias / char interplay                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectGenerationContext — oclif aliases / chars', () => {
  it('reads under the canonical flag name (oclif normalizes aliases)', () => {
    // ALIAS_MAP: aspectRatio: { aliases: ['ar'] }
    // oclif stores --ar values under the canonical 'aspect-ratio' key when
    // declared via Flags.string({ aliases: ['ar'] }). Block 6 reads only
    // the canonical name and doesn't need to be alias-aware.
    const cat = loadCatalog([MODEL_ENUM_STRING], ALIAS_MAP);
    const ctx = collectGenerationContext({ 'aspect-ratio': '16:9' }, cat);
    expect(ctx).toEqual({ aspectRatio: '16:9' });
  });

  it('reads under the override flag name (imageUrls → --image)', () => {
    const cat = loadCatalog(
      [
        {
          id: 'fx-text-as-image-key',
          paramConfig: { imageUrls: { descriptor: { kind: 'text' } } },
        },
      ],
      ALIAS_MAP,
    );
    // imageUrls has flag override 'image' in ALIAS_MAP
    // (NB: real imageUrls is a file kind — for THIS test we use a text descriptor
    //  to verify the override path; the surface ends up using flag 'image')
    const ctx = collectGenerationContext({ image: 'a-string-not-a-file' }, cat);
    expect(ctx).toEqual({ imageUrls: 'a-string-not-a-file' });
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Real-SDK integration                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('collectGenerationContext — against the real SDK', () => {
  it('produces a sensible ctx for a realistic flag set', async () => {
    const { getCatalog } = await import('../../02-catalog/index.ts');
    const ctx = collectGenerationContext(
      {
        prompt: 'a neon city at night',
        'aspect-ratio': '16:9',
        duration: '10',
        'generate-audio': true,
      },
      getCatalog(),
    );
    expect(ctx.prompt).toBe('a neon city at night');
    expect(ctx.aspectRatio).toBe('16:9');
    // `duration` is enum:number across most video models; Block 2 returns a number.
    expect(typeof ctx.duration).toBe('number');
    expect(ctx.generateAudio).toBe(true);
  });

  it('silently drops flags that have no SDK descriptor (e.g. sfx-prompt, externalTaskId)', async () => {
    // Both fields appear in the EXPECTED_ORPHAN_ALIASES list from Block 3's
    // README — the SDK's buildPayload reads them but paramConfig doesn't
    // declare them, so the catalog has no surface. Block 6 is silent.
    // (seed left this club in SDK 3.25.0 when flux-3-video declared it.)
    const { getCatalog } = await import('../../02-catalog/index.ts');
    const ctx = collectGenerationContext(
      {
        prompt: 'hi',
        'sfx-prompt': 'rain on a tin roof',
        'external-task-id': 'campaign-007',
      },
      getCatalog(),
    );
    expect(ctx.prompt).toBe('hi');
    expect(ctx).not.toHaveProperty('soundEffectPrompt');
    expect(ctx).not.toHaveProperty('externalTaskId');
  });
});

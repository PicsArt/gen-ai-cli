/**
 * Block 2 — Coercion.
 *
 * Pure value conversion + camelCase ↔ kebab-case helpers.
 *
 * Test plan:
 *   - One section per descriptor kind. Happy + sad paths.
 *   - File and object kinds throw — those values are handled by other blocks.
 *   - camelToKebab / kebabToCamel: representative cases + property-based
 *     round-trip across the 36 audit keys.
 */
import type {
  BooleanDescriptor,
  EnumDescriptor,
  FileDescriptor,
  ObjectDescriptor,
  RangeDescriptor,
  TextDescriptor,
} from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { UsageError } from '#infra/errors/usage.ts';
import { autoNumberIndexField, camelToKebab, coerceToDescriptor, kebabToCamel, subfieldFlagName } from './coercion.ts';

/* ─────────────────────────────────────────────────────────────────────────── */
/*  camelToKebab                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('camelToKebab', () => {
  it.each([
    ['prompt', 'prompt'],
    ['aspectRatio', 'aspect-ratio'],
    ['removeBackgroundNoise', 'remove-background-noise'],
    ['bgmPrompt', 'bgm-prompt'],
    ['multiPrompt', 'multi-prompt'],
    ['omniImageList', 'omni-image-list'],
    ['sourceImageId', 'source-image-id'],
    ['cfgScale', 'cfg-scale'],
    ['voiceId', 'voice-id'],
    ['endFrame', 'end-frame'],
  ])('%s → %s', (input, expected) => {
    expect(camelToKebab(input)).toBe(expected);
  });

  it('throws on empty string', () => {
    expect(() => camelToKebab('')).toThrow();
  });

  it('handles a single lowercase letter', () => {
    expect(camelToKebab('a')).toBe('a');
  });

  it('preserves digits', () => {
    expect(camelToKebab('image2Url')).toBe('image2-url');
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  kebabToCamel                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('kebabToCamel', () => {
  it.each([
    ['prompt', 'prompt'],
    ['aspect-ratio', 'aspectRatio'],
    ['remove-background-noise', 'removeBackgroundNoise'],
    ['bgm-prompt', 'bgmPrompt'],
    ['source-image-id', 'sourceImageId'],
  ])('%s → %s', (input, expected) => {
    expect(kebabToCamel(input)).toBe(expected);
  });

  it('throws on empty string', () => {
    expect(() => kebabToCamel('')).toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Round-trip property: camelToKebab → kebabToCamel returns the original     */
/* ─────────────────────────────────────────────────────────────────────────── */

const AUDIT_KEYS = [
  'aspectRatio',
  'audioId',
  'audioUrl',
  'accent',
  'background',
  'bgmPrompt',
  'cfgScale',
  'characterOrientation',
  'count',
  'duration',
  'elementDescription',
  'elementList',
  'elementName',
  'elementVoiceId',
  'endFrame',
  'enhancePrompt',
  'externalTaskId',
  'generateAudio',
  'guidance',
  'humanFidelity',
  'imageReference',
  'imageUrls',
  'imageWeight',
  'keepOriginalSound',
  'language',
  'multiPrompt',
  'multiShot',
  'negativePrompt',
  'omniImageList',
  'omniVideoList',
  'outputFormat',
  'prompt',
  'quality',
  'referenceType',
  'removeBackgroundNoise',
  'renderingSpeed',
  'resolution',
  'sceneImage',
  'seed',
  'shotType',
  'similarity',
  'size',
  'sourceImageId',
  'startFrame',
  'style',
  'styleImage',
  'substyle',
  'thinkingLevel',
  'videoId',
  'videoUrl',
  'voiceId',
  'voiceList',
];

describe('camelToKebab ⇄ kebabToCamel round-trip', () => {
  it.each(AUDIT_KEYS)('%s round-trips', (key) => {
    expect(kebabToCamel(camelToKebab(key))).toBe(key);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  coerceToDescriptor — kind: enum<string>                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('coerceToDescriptor — enum<string>', () => {
  const desc: EnumDescriptor<string> = {
    kind: 'enum',
    valueType: 'string',
    options: [{ id: '16:9' }, { id: '9:16' }, { id: '1:1' }],
    default: '16:9',
  };

  it('accepts a valid option', () => {
    expect(coerceToDescriptor('9:16', desc)).toBe('9:16');
  });

  it('rejects an unknown option with a UsageError listing the choices', () => {
    expect(() => coerceToDescriptor('21:9', desc)).toThrow(UsageError);
    try {
      coerceToDescriptor('21:9', desc);
    } catch (e) {
      expect((e as Error).message).toContain('21:9');
      expect((e as Error).message).toContain('16:9');
      expect((e as Error).message).toContain('9:16');
    }
  });

  it('rejects non-string input with a UsageError', () => {
    expect(() => coerceToDescriptor(42, desc)).toThrow(UsageError);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  coerceToDescriptor — kind: enum<number>                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('coerceToDescriptor — enum<number>', () => {
  const desc: EnumDescriptor<number> = {
    kind: 'enum',
    valueType: 'number',
    options: [{ id: 5 }, { id: 10 }, { id: 15 }],
    default: 5,
  };

  it('parses a numeric-string value', () => {
    expect(coerceToDescriptor('10', desc)).toBe(10);
  });

  it('accepts an already-numeric value', () => {
    expect(coerceToDescriptor(15, desc)).toBe(15);
  });

  it('rejects a non-numeric string', () => {
    expect(() => coerceToDescriptor('abc', desc)).toThrow(UsageError);
  });

  it('rejects a numeric value that is not in the options', () => {
    expect(() => coerceToDescriptor('7', desc)).toThrow(UsageError);
    expect(() => coerceToDescriptor(7, desc)).toThrow(UsageError);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  coerceToDescriptor — kind: boolean                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('coerceToDescriptor — boolean', () => {
  const desc: BooleanDescriptor = { kind: 'boolean', default: false };

  it('passes through true', () => {
    expect(coerceToDescriptor(true, desc)).toBe(true);
  });

  it('passes through false', () => {
    expect(coerceToDescriptor(false, desc)).toBe(false);
  });

  it('coerces string "true" / "false"', () => {
    expect(coerceToDescriptor('true', desc)).toBe(true);
    expect(coerceToDescriptor('false', desc)).toBe(false);
  });

  it('rejects non-boolean strings', () => {
    expect(() => coerceToDescriptor('yes', desc)).toThrow(UsageError);
    expect(() => coerceToDescriptor('1', desc)).toThrow(UsageError);
  });

  it('rejects non-boolean non-string values', () => {
    expect(() => coerceToDescriptor(0, desc)).toThrow(UsageError);
  });

  it('treats null as "flag not provided", same as undefined', () => {
    // Batch manifests can carry explicit nulls; coercing them onward would
    // invent values (e.g. Number(null) === 0 for range descriptors).
    expect(coerceToDescriptor(null, desc)).toBeUndefined();
    expect(coerceToDescriptor(undefined, desc)).toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  coerceToDescriptor — kind: range                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('coerceToDescriptor — range', () => {
  const desc: RangeDescriptor = { kind: 'range', min: 0, max: 100, default: 50 };

  it('parses a numeric-string value inside the bounds', () => {
    expect(coerceToDescriptor('75', desc)).toBe(75);
  });

  it('accepts the min and max boundary values', () => {
    expect(coerceToDescriptor('0', desc)).toBe(0);
    expect(coerceToDescriptor('100', desc)).toBe(100);
  });

  it('accepts an already-numeric value', () => {
    expect(coerceToDescriptor(42, desc)).toBe(42);
  });

  it('rejects values below min', () => {
    expect(() => coerceToDescriptor('-1', desc)).toThrow(UsageError);
  });

  it('rejects values above max', () => {
    expect(() => coerceToDescriptor('101', desc)).toThrow(UsageError);
  });

  it('rejects non-numeric strings', () => {
    expect(() => coerceToDescriptor('abc', desc)).toThrow(UsageError);
  });

  it('rejects NaN', () => {
    expect(() => coerceToDescriptor(Number.NaN, desc)).toThrow(UsageError);
  });

  it('error message mentions the bounds and the offending value', () => {
    try {
      coerceToDescriptor('500', desc);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('500');
      expect(msg).toContain('0');
      expect(msg).toContain('100');
    }
  });

  it('handles a range with an undefined default (e.g. seed)', () => {
    const seedDesc: RangeDescriptor = {
      kind: 'range',
      min: 0,
      max: 2_147_483_647,
      default: undefined as unknown as number,
    };
    expect(coerceToDescriptor('42', seedDesc)).toBe(42);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  coerceToDescriptor — kind: text                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('coerceToDescriptor — text', () => {
  it('accepts a plain string', () => {
    const desc: TextDescriptor = { kind: 'text' };
    expect(coerceToDescriptor('hello world', desc)).toBe('hello world');
  });

  it('rejects non-string values', () => {
    const desc: TextDescriptor = { kind: 'text' };
    expect(() => coerceToDescriptor(42, desc)).toThrow(UsageError);
    expect(() => coerceToDescriptor(true, desc)).toThrow(UsageError);
  });

  it('enforces maxLength', () => {
    const desc: TextDescriptor = { kind: 'text', maxLength: 10 };
    expect(coerceToDescriptor('1234567890', desc)).toBe('1234567890');
    expect(() => coerceToDescriptor('12345678901', desc)).toThrow(UsageError);
  });

  it('enforces minLength', () => {
    const desc: TextDescriptor = { kind: 'text', minLength: 3 };
    expect(coerceToDescriptor('abc', desc)).toBe('abc');
    expect(() => coerceToDescriptor('ab', desc)).toThrow(UsageError);
  });

  it('error message cites the limit', () => {
    const desc: TextDescriptor = { kind: 'text', maxLength: 5 };
    try {
      coerceToDescriptor('toolongstring', desc);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('5');
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  coerceToDescriptor — kind: file (not handled here)                        */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('coerceToDescriptor — file (delegates upstream)', () => {
  it('throws an internal Error explaining who owns file inputs', () => {
    const desc: FileDescriptor = { kind: 'file', accept: 'image' };
    expect(() => coerceToDescriptor('anything', desc)).toThrow(/file/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  coerceToDescriptor — kind: object (not handled here)                      */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('coerceToDescriptor — object (delegates upstream)', () => {
  it('throws an internal Error explaining who owns object inputs', () => {
    const desc: ObjectDescriptor = {
      kind: 'object',
      fields: { foo: { kind: 'text' } },
    };
    expect(() => coerceToDescriptor('anything', desc)).toThrow(/object/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  coerceToDescriptor — undefined input is a pass-through                    */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('coerceToDescriptor — undefined input', () => {
  it('returns undefined for any descriptor kind when raw is undefined', () => {
    const text: TextDescriptor = { kind: 'text' };
    const range: RangeDescriptor = { kind: 'range', min: 0, max: 10, default: 5 };
    const bool: BooleanDescriptor = { kind: 'boolean', default: false };
    expect(coerceToDescriptor(undefined, text)).toBeUndefined();
    expect(coerceToDescriptor(undefined, range)).toBeUndefined();
    expect(coerceToDescriptor(undefined, bool)).toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  subfieldFlagName — uniform kebab regardless of subkey shape               */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('subfieldFlagName — naming rules', () => {
  it('composes `<parent>-<subkey-kebab>` for camelCase subkeys', () => {
    expect(subfieldFlagName('multi-prompt', 'shotPrompt')).toBe('multi-prompt-shot-prompt');
  });

  it('normalizes snake_case subkeys to kebab-case (JSON-API names like `image_url`)', () => {
    expect(subfieldFlagName('omni-image', 'image_url')).toBe('omni-image-image-url');
    expect(subfieldFlagName('omni-video', 'keep_original_sound')).toBe('omni-video-keep-original-sound');
    expect(subfieldFlagName('omni-video', 'refer_type')).toBe('omni-video-refer-type');
  });

  it('handles already-kebab subkeys idempotently', () => {
    expect(subfieldFlagName('foo', 'bar-baz')).toBe('foo-bar-baz');
  });

  it('handles single-word subkeys', () => {
    expect(subfieldFlagName('voice-list', 'voice_id')).toBe('voice-list-voice-id');
  });

  it('throws on empty subkey (programming error, not user input)', () => {
    expect(() => subfieldFlagName('foo', '')).toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  autoNumberIndexField — positional 1..N backfill                           */
/* ─────────────────────────────────────────────────────────────────────────── */

describe('autoNumberIndexField — 1-based positional indices', () => {
  it('fills 1..N when every item has index=0 (descriptor default)', () => {
    const items = [
      { index: 0, prompt: 'a' },
      { index: 0, prompt: 'b' },
      { index: 0, prompt: 'c' },
    ];
    const out = autoNumberIndexField(items);
    expect(out.map((i) => i.index)).toEqual([1, 2, 3]);
  });

  it('fills 1..N when items have no index field at all', () => {
    const items: Record<string, unknown>[] = [{ prompt: 'a' }, { prompt: 'b' }];
    const out = autoNumberIndexField(items);
    expect(out.map((i) => i.index)).toEqual([1, 2]);
  });

  it('preserves caller-supplied non-zero indices verbatim', () => {
    const items = [
      { index: 2, prompt: 'a' },
      { index: 4, prompt: 'b' },
    ];
    const out = autoNumberIndexField(items);
    expect(out.map((i) => i.index)).toEqual([2, 4]);
  });

  it('preserves a mix when at least one index is non-zero (no rewriting)', () => {
    const items = [
      { index: 0, prompt: 'a' },
      { index: 3, prompt: 'b' },
      { index: 0, prompt: 'c' },
    ];
    const out = autoNumberIndexField(items);
    expect(out.map((i) => i.index)).toEqual([0, 3, 0]);
  });

  it('handles the empty array safely', () => {
    expect(autoNumberIndexField([])).toEqual([]);
  });

  it('returns a fresh array — does not mutate the input', () => {
    const items: Record<string, unknown>[] = [{ prompt: 'a' }];
    const out = autoNumberIndexField(items);
    expect(out).not.toBe(items);
    expect(items[0]).not.toHaveProperty('index');
  });
});

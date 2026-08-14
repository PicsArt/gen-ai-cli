/**
 * Interpret-half of object-descriptor handling. Verifies that
 * `interpretObjectArray` correctly reads single- and multi-field flag
 * shapes back into items, applies defaults, enforces array.max, and
 * surfaces UsageError on missing required subfields and coercion
 * failures.
 */
import type { ObjectDescriptor, ParamDescriptor } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { UsageError } from '#infra/errors/usage.ts';
import type { ParamSurface } from '../../02-catalog/index.ts';
import { interpretObjectArray } from './objects.ts';

function surface(flag: string, descriptor: ObjectDescriptor): ParamSurface {
  return {
    key: flag,
    flag,
    flagAliases: [],
    descriptor,
    models: [],
    requiredInModels: [],
    perModelLabels: new Map(),
    descriptorsByModel: new Map(),
    conflicts: [],
  };
}

function nonObjectSurface(): ParamSurface {
  return {
    key: 'prompt',
    flag: 'prompt',
    flagAliases: [],
    descriptor: { kind: 'text' },
    models: [],
    requiredInModels: [],
    perModelLabels: new Map(),
    descriptorsByModel: new Map(),
    conflicts: [],
  };
}

describe('interpretObjectArray — single-field', () => {
  const voiceList = surface('voice', {
    kind: 'object',
    array: { max: 2 },
    fields: { voice_id: { kind: 'text' } },
  });

  it('wraps each user value in an object keyed by the single subfield', () => {
    const items = interpretObjectArray({ voice: ['vx_1', 'vx_2'] }, voiceList);
    expect(items).toEqual([{ voice_id: 'vx_1' }, { voice_id: 'vx_2' }]);
  });

  it('returns undefined when the flag is missing', () => {
    expect(interpretObjectArray({}, voiceList)).toBeUndefined();
  });

  it('returns undefined when the flag value is an empty array', () => {
    expect(interpretObjectArray({ voice: [] }, voiceList)).toBeUndefined();
  });

  it('throws when item count exceeds array.max', () => {
    expect(() => interpretObjectArray({ voice: ['a', 'b', 'c'] }, voiceList)).toThrow(UsageError);
  });

  it('the too-many-items error names the actual flag (--voice, not --voice-*)', () => {
    // Single-field objects expose ONE flag named after the parent — there
    // are no `--voice-<subfield>` flags to point at.
    expect(() => interpretObjectArray({ voice: ['a', 'b', 'c'] }, voiceList)).toThrow(/--voice accepts at most 2/);
  });
});

describe('interpretObjectArray — multi-field', () => {
  const shotSurface = surface('shot', {
    kind: 'object',
    array: { max: 6 },
    fields: {
      index: { kind: 'range', min: 0, max: 5, default: 0 },
      prompt: { kind: 'text', maxLength: 512 },
      duration: { kind: 'text' },
    },
  });

  it('zips equal-length subfield arrays into an item list', () => {
    const items = interpretObjectArray(
      {
        'shot-prompt': ['wide shot', 'close-up'],
        'shot-duration': ['5', '7'],
        'shot-index': ['0', '1'],
      },
      shotSurface,
    );
    expect(items).toEqual([
      { index: 0, prompt: 'wide shot', duration: '5' },
      { index: 1, prompt: 'close-up', duration: '7' },
    ]);
  });

  it('backfills consecutive indices FROM THE DESCRIPTOR MIN when the caller does not supply --shot-index', () => {
    // `index` is a special subfield: when the caller does not pass the
    // --*-index flag, autoNumberIndexField fills consecutive values starting
    // at the descriptor's declared minimum. Kling V3 multiPrompt declares
    // range 0-5 with array.max 6 — 1-based numbering would overflow the
    // range at six shots (indices 1..6 vs max 5).
    const items = interpretObjectArray(
      {
        'shot-prompt': ['wide shot', 'close-up'],
        'shot-duration': ['5', '7'],
      },
      shotSurface,
    );
    expect(items).toEqual([
      { index: 0, prompt: 'wide shot', duration: '5' },
      { index: 1, prompt: 'close-up', duration: '7' },
    ]);
  });

  it('six shots stay within the declared index range (0..5, never 1..6)', () => {
    const items = interpretObjectArray(
      {
        'shot-prompt': ['a', 'b', 'c', 'd', 'e', 'f'],
        'shot-duration': ['1', '1', '1', '1', '1', '1'],
      },
      shotSurface,
    );
    expect((items as Record<string, unknown>[]).map((i) => i.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('preserves an explicit all-zero --shot-index verbatim (caller expressed intent)', () => {
    const items = interpretObjectArray(
      {
        'shot-prompt': ['a', 'b'],
        'shot-duration': ['5', '7'],
        'shot-index': ['0', '0'],
      },
      shotSurface,
    );
    expect((items as Record<string, unknown>[]).map((i) => i.index)).toEqual([0, 0]);
  });

  it('backfills 1-based when the index descriptor min is 1', () => {
    const oneBased = surface('shot', {
      kind: 'object',
      array: { max: 6 },
      fields: {
        index: { kind: 'range', min: 1, max: 6, default: 1 },
        prompt: { kind: 'text' },
      },
    });
    const items = interpretObjectArray({ 'shot-prompt': ['a', 'b'] }, oneBased);
    expect((items as Record<string, unknown>[]).map((i) => i.index)).toEqual([1, 2]);
  });

  it('uses MAX subfield-array length and preserves caller-supplied indices', () => {
    const items = interpretObjectArray(
      {
        'shot-prompt': ['a', 'b', 'c'],
        'shot-duration': ['5', '6', '7'],
        'shot-index': ['0', '1'],
      },
      shotSurface,
    );
    // Caller supplied at least one non-zero index ('1') → auto-numbering
    // is suppressed; we keep the user's values verbatim and backfill the
    // missing slot with the descriptor default (0).
    expect(items).toEqual([
      { index: 0, prompt: 'a', duration: '5' },
      { index: 1, prompt: 'b', duration: '6' },
      { index: 0, prompt: 'c', duration: '7' },
    ]);
  });

  it('throws when a subfield without default is missing at a needed index', () => {
    expect(() =>
      interpretObjectArray(
        {
          'shot-prompt': ['a', 'b'],
          'shot-duration': ['5'],
        },
        shotSurface,
      ),
    ).toThrow(UsageError);
  });

  it('returns undefined when no subfield flag was passed', () => {
    expect(interpretObjectArray({}, shotSurface)).toBeUndefined();
  });

  it('throws when total item count exceeds array.max', () => {
    expect(() =>
      interpretObjectArray(
        {
          'shot-prompt': new Array(7).fill('p'),
          'shot-duration': new Array(7).fill('5'),
        },
        shotSurface,
      ),
    ).toThrow(UsageError);
  });

  it('the too-many-items error names the subfield flag family (--shot-*)', () => {
    expect(() =>
      interpretObjectArray(
        {
          'shot-prompt': new Array(7).fill('p'),
          'shot-duration': new Array(7).fill('5'),
        },
        shotSurface,
      ),
    ).toThrow(/--shot-\* accepts at most 6/);
  });

  it('bubbles up coercion errors from primitives (e.g. range bound)', () => {
    expect(() =>
      interpretObjectArray(
        {
          'shot-prompt': ['a'],
          'shot-duration': ['5'],
          'shot-index': ['99'],
        },
        shotSurface,
      ),
    ).toThrow(UsageError);
  });

  it('bubbles up coercion errors from text maxLength', () => {
    const tinyShot = surface('shot', {
      kind: 'object',
      fields: {
        prompt: { kind: 'text', maxLength: 3 },
      },
    });
    expect(() => interpretObjectArray({ shot: ['toolong'] }, tinyShot)).toThrow(UsageError);
  });
});

describe('interpretObjectArray — error paths', () => {
  it('throws when the descriptor is not an object', () => {
    expect(() => interpretObjectArray({}, nonObjectSurface())).toThrow(/object/i);
  });

  it('treats a non-Array flag value as missing for a multi-field ARRAY descriptor', () => {
    const s = surface('shot', {
      kind: 'object',
      array: { max: 6 },
      fields: { prompt: { kind: 'text' }, duration: { kind: 'text' } },
    });
    const items = interpretObjectArray({ 'shot-prompt': 'wide shot' as unknown as string[] }, s);
    expect(items).toBeUndefined();
  });
});

describe('interpretObjectArray — subfield kinds with defaults', () => {
  it('uses enum default for missing optional subfield', () => {
    const s = surface('omni-image', {
      kind: 'object',
      array: { max: 10 },
      fields: {
        image_url: { kind: 'text' },
        type: {
          kind: 'enum',
          valueType: 'string',
          options: [{ id: 'first_frame' }, { id: 'end_frame' }],
          default: 'first_frame',
        },
      },
    });
    // Flag name is kebab-case even when the SDK subkey was snake_case
    // (e.g. `image_url`). The reassembled item key keeps the original
    // SDK subkey so buildPayload's snake_case API names stay intact.
    const items = interpretObjectArray({ 'omni-image-image-url': ['https://a.png'] }, s);
    expect(items).toEqual([{ image_url: 'https://a.png', type: 'first_frame' }]);
  });

  it('uses boolean default for missing optional subfield', () => {
    const s = surface('thing', {
      kind: 'object',
      array: { max: 4 },
      fields: {
        name: { kind: 'text' },
        active: { kind: 'boolean', default: true },
      },
    });
    const items = interpretObjectArray({ 'thing-name': ['foo'] }, s);
    expect(items).toEqual([{ name: 'foo', active: true }]);
  });

  it('uses range default for missing optional subfield', () => {
    const s = surface('thing', {
      kind: 'object',
      array: { max: 4 },
      fields: {
        name: { kind: 'text' },
        weight: { kind: 'range', min: 0, max: 100, default: 50 },
      },
    });
    const items = interpretObjectArray({ 'thing-name': ['x'] }, s);
    expect(items).toEqual([{ name: 'x', weight: 50 }]);
  });

  it('throws on range subfield with no default at a needed index', () => {
    const s = surface('thing', {
      kind: 'object',
      fields: {
        name: { kind: 'text' },
        weight: { kind: 'range', min: 0, max: 100, default: undefined as unknown as number },
      },
    });
    expect(() => interpretObjectArray({ 'thing-name': ['x'] }, s)).toThrow(UsageError);
  });
});

describe('multiPrompt — worked example end-to-end', () => {
  const multiPrompt: ParamDescriptor = {
    kind: 'object',
    array: { max: 6 },
    fields: {
      index: { kind: 'range', min: 0, max: 5, default: 0 },
      prompt: { kind: 'text', maxLength: 512 },
      duration: { kind: 'text' },
    },
  };
  const shotSurface = surface('shot', multiPrompt);

  it('interprets a realistic two-shot user invocation with positional indices', () => {
    const items = interpretObjectArray(
      {
        'shot-prompt': ['wide shot of a sunset', 'close-up of a leaf'],
        'shot-duration': ['5', '7'],
      },
      shotSurface,
    );
    expect(items).toEqual([
      { index: 0, prompt: 'wide shot of a sunset', duration: '5' },
      { index: 1, prompt: 'close-up of a leaf', duration: '7' },
    ]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Non-array objects — `array` undefined means ONE bare object            */
/* ─────────────────────────────────────────────────────────────────────── */

describe('interpretObjectArray — non-array (single object) descriptors', () => {
  // SDK convention: `array: undefined` = the param is a single object, not a
  // list (e.g. picsart-qwen-image-edit-angle loraWeights). The payload must
  // be `{...}`, not `[{...}]`.
  const loraSurface = surface('lora-weights', {
    kind: 'object',
    fields: {
      lora_angle: { kind: 'range', min: 0, max: 1, default: 1 },
      lora_angle_lighting: { kind: 'range', min: 0, max: 1, default: 1 },
    },
  });

  it('returns a bare object (not an array) from scalar subfield flags', () => {
    const value = interpretObjectArray({ 'lora-weights-lora-angle': '0.5' }, loraSurface);
    expect(value).toEqual({ lora_angle: 0.5, lora_angle_lighting: 1 });
  });

  it('returns undefined when no subfield flag is set', () => {
    expect(interpretObjectArray({}, loraSurface)).toBeUndefined();
  });

  it('single-field non-array object returns a bare object from a scalar flag', () => {
    const single = surface('voice', {
      kind: 'object',
      fields: { voice_id: { kind: 'text' } },
    });
    expect(interpretObjectArray({ voice: 'vx_1' }, single)).toEqual({ voice_id: 'vx_1' });
  });
});

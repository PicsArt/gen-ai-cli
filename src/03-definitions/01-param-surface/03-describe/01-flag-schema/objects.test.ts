/**
 * Describe-half of object-descriptor handling. Verifies the flag set
 * `describeObjectFlags` emits for both single-field and multi-field
 * objects, including the kebab-case naming convention.
 */
import type { ObjectDescriptor } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import type { ParamSurface } from '../../02-catalog/index.ts';
import { describeObjectFlags } from './objects.ts';

function surface(flag: string, descriptor: ObjectDescriptor): ParamSurface {
  return {
    key: flag,
    flag,
    flagAliases: [],
    descriptor,
    models: [],
    requiredInModels: [],
    perModelLabels: new Map(),
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
    conflicts: [],
  };
}

describe('describeObjectFlags — single-field objects', () => {
  it('emits one repeatable flag named after the parent', () => {
    const s = surface('voice', {
      kind: 'object',
      fields: { voice_id: { kind: 'text' } },
    });
    const flags = describeObjectFlags(s);
    expect(Object.keys(flags)).toEqual(['voice']);
  });

  it('the emitted flag is multi (repeatable)', () => {
    const s = surface('element', {
      kind: 'object',
      fields: { element_id: { kind: 'text' } },
    });
    const flags = describeObjectFlags(s) as Record<string, { multiple: boolean }>;
    expect(flags.element.multiple).toBe(true);
  });
});

describe('describeObjectFlags — multi-field objects', () => {
  it('emits one repeatable flag per subfield, prefixed by parent flag', () => {
    const s = surface('shot', {
      kind: 'object',
      array: { max: 6 },
      fields: {
        index: { kind: 'range', min: 0, max: 5, default: 0 },
        prompt: { kind: 'text', maxLength: 512 },
        duration: { kind: 'text' },
      },
    });
    const flags = describeObjectFlags(s);
    expect(Object.keys(flags).sort()).toEqual(['shot-duration', 'shot-index', 'shot-prompt']);
  });

  it('camelCase subfield keys produce kebab-case suffixes', () => {
    const s = surface('omni-video', {
      kind: 'object',
      fields: {
        video_url: { kind: 'text' },
        refer_type: { kind: 'enum', valueType: 'string', options: [{ id: 'base' }], default: 'base' },
        keep_original_sound: {
          kind: 'enum',
          valueType: 'string',
          options: [{ id: 'yes' }, { id: 'no' }],
          default: 'yes',
        },
      },
    });
    const flags = describeObjectFlags(s);
    // Subkeys arrive snake_case (matching the JSON-API field names);
    // flag names are uniform kebab-case so users never type underscores.
    expect(Object.keys(flags).sort()).toEqual([
      'omni-video-keep-original-sound',
      'omni-video-refer-type',
      'omni-video-video-url',
    ]);
  });

  it('every emitted flag is multi (repeatable)', () => {
    const s = surface('shot', {
      kind: 'object',
      fields: {
        prompt: { kind: 'text' },
        duration: { kind: 'text' },
      },
    });
    const flags = describeObjectFlags(s) as Record<string, { multiple: boolean }>;
    for (const f of Object.values(flags)) expect(f.multiple).toBe(true);
  });
});

describe('describeObjectFlags — error paths', () => {
  it('throws when the descriptor is not an object', () => {
    expect(() => describeObjectFlags(nonObjectSurface())).toThrow(/object/i);
  });

  it('throws when the object has no fields', () => {
    const s = surface('empty', { kind: 'object', fields: {} });
    expect(() => describeObjectFlags(s)).toThrow();
  });
});

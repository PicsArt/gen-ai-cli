/**
 * Block 5 — Flag Generator.
 *
 * Tests verify:
 *   1. Each descriptor kind produces the expected oclif Flag shape.
 *   2. Aliases (char, flagAliases) from the catalog are applied.
 *   3. File descriptors are skipped (file pipeline owns them).
 *   4. Object descriptors delegate to Block 4 (generateObjectFlags).
 *   5. The real SDK catalog produces a stable flag set (snapshot).
 *
 * Tests assert on observable properties (multiple, options, char, aliases,
 * description) rather than oclif's internal Flag<T> type. Same pattern as
 * Block 4.
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
import { generateFlagsFromCatalog } from './flag-schema.ts';

/** Narrow type for asserting on flag shape without coupling to oclif internals. */
type FlagShape = {
  type?: 'option' | 'boolean';
  description?: string;
  multiple?: boolean;
  allowNo?: boolean;
  options?: readonly string[];
  char?: string;
  aliases?: readonly string[];
  parse?: unknown;
};

function asShape(flags: Record<string, unknown>, name: string): FlagShape {
  const f = flags[name];
  if (f === undefined) throw new Error(`flag '${name}' missing`);
  return f as FlagShape;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Empty catalog                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — empty', () => {
  it('produces an empty FlagSet from an empty catalog', () => {
    const cat = loadCatalog([], ALIAS_MAP);
    const flags = generateFlagsFromCatalog(cat);
    expect(Object.keys(flags)).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  enum<string>                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — enum<string>', () => {
  const cat = loadCatalog([MODEL_ENUM_STRING], ALIAS_MAP);
  const flags = generateFlagsFromCatalog(cat);

  it('emits a flag under the kebab-resolved name', () => {
    expect(flags['aspect-ratio']).toBeDefined();
  });

  it('the flag carries the descriptor options as strings', () => {
    const shape = asShape(flags, 'aspect-ratio');
    expect(shape.options).toEqual(['16:9', '9:16']);
  });

  it('description falls back to the per-model label', () => {
    const shape = asShape(flags, 'aspect-ratio');
    expect(shape.description).toContain('Aspect Ratio');
  });

  it('aspectRatio alias --ar is applied', () => {
    const shape = asShape(flags, 'aspect-ratio');
    expect(shape.aliases).toContain('ar');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  enum<number>                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — enum<number>', () => {
  const cat = loadCatalog([MODEL_ENUM_NUMBER], ALIAS_MAP);
  const flags = generateFlagsFromCatalog(cat);

  it('emits a flag under the resolved name (alias gives char "d")', () => {
    expect(flags.duration).toBeDefined();
  });

  it('options are stringified (numeric coercion happens in Block 6)', () => {
    const shape = asShape(flags, 'duration');
    expect(shape.options).toEqual(['5', '10', '15']);
  });

  it('char from ALIAS_MAP applies (duration → -d)', () => {
    const shape = asShape(flags, 'duration');
    expect(shape.char).toBe('d');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  boolean                                                               */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — boolean', () => {
  const cat = loadCatalog([MODEL_BOOLEAN], ALIAS_MAP);
  const flags = generateFlagsFromCatalog(cat);

  it('emits a boolean flag with allowNo: true', () => {
    expect(flags['generate-audio']).toBeDefined();
    const shape = asShape(flags, 'generate-audio');
    expect(shape.allowNo).toBe(true);
  });

  it('boolean flags do NOT have an options list', () => {
    const shape = asShape(flags, 'generate-audio');
    expect(shape.options).toBeUndefined();
  });

  it('alias --audio-gen is registered for generateAudio', () => {
    const shape = asShape(flags, 'generate-audio');
    expect(shape.aliases).toContain('audio-gen');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  range                                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — range', () => {
  const cat = loadCatalog([MODEL_RANGE], ALIAS_MAP);
  const flags = generateFlagsFromCatalog(cat);

  it('emits a string flag (range parsing happens in Block 6)', () => {
    expect(flags['cfg-scale']).toBeDefined();
    const shape = asShape(flags, 'cfg-scale');
    expect(shape.options).toBeUndefined();
    expect(shape.allowNo).toBeUndefined();
  });

  it('alias --cfg is registered for cfgScale', () => {
    const shape = asShape(flags, 'cfg-scale');
    expect(shape.aliases).toContain('cfg');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  text                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — text', () => {
  const cat = loadCatalog([MODEL_TEXT], ALIAS_MAP);
  const flags = generateFlagsFromCatalog(cat);

  it('emits a string flag', () => {
    expect(flags.prompt).toBeDefined();
    const shape = asShape(flags, 'prompt');
    expect(shape.options).toBeUndefined();
  });

  it('char from ALIAS_MAP applies (prompt → -p)', () => {
    const shape = asShape(flags, 'prompt');
    expect(shape.char).toBe('p');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  file — path flag (resolver still does upload)                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — file', () => {
  const cat = loadCatalog([MODEL_FILE], ALIAS_MAP);
  const flags = generateFlagsFromCatalog(cat);

  it('emits a path flag under the alias-resolved name (imageUrls → --image)', () => {
    expect(flags.image).toBeDefined();
  });

  it('a file with array → multi: true', () => {
    expect(asShape(flags, 'image').multiple).toBe(true);
  });

  it('description mentions the accept type', () => {
    expect(asShape(flags, 'image').description).toMatch(/image/i);
  });

  it('alias char from ALIAS_MAP applies (imageUrls → -i)', () => {
    expect(asShape(flags, 'image').char).toBe('i');
  });

  it('a single model owns the flag → its label and exact max are trusted', () => {
    // MODEL_FILE declares imageUrls as "Source Images", array max 4.
    const desc = asShape(flags, 'image').description ?? '';
    expect(desc).toContain('Source Images');
    expect(desc).toContain('max 4');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  file — conflicting labels / caps across models collapse to neutral      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — file flag shared by disagreeing models', () => {
  // Two models declare imageUrls with DIFFERENT labels and DIFFERENT caps —
  // the real-world shape (Veo: "Reference Images"/3, Kling: "Person Photo"/1).
  const veoLike: ModelLike = {
    id: 'veo-like',
    paramConfig: {
      imageUrls: {
        label: 'Reference Images',
        descriptor: { kind: 'file', accept: 'image', array: { max: 3 } },
      },
    },
  };
  const klingLike: ModelLike = {
    id: 'kling-like',
    paramConfig: {
      imageUrls: {
        label: 'Person Photo (upper body)',
        descriptor: { kind: 'file', accept: 'image', array: { max: 1 } },
      },
    },
  };
  const cat = loadCatalog([klingLike, veoLike], ALIAS_MAP);
  const flags = generateFlagsFromCatalog(cat);
  const desc = () => asShape(flags, 'image').description ?? '';

  it('does NOT surface either model-specific label', () => {
    expect(desc()).not.toContain('Person Photo');
    expect(desc()).not.toContain('Reference Images');
  });

  it('uses a neutral label derived from the flag name', () => {
    expect(desc()).toContain('Image');
  });

  it('does NOT assert a misleading specific max — says repeatable', () => {
    expect(desc()).not.toMatch(/max \d/);
    expect(desc()).toContain('repeatable');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  object — delegates to Block 4                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — object (delegates to Block 4)', () => {
  const cat = loadCatalog([MODEL_OBJECT], ALIAS_MAP);
  const flags = generateFlagsFromCatalog(cat);

  it('emits per-subfield flags via generateObjectFlags', () => {
    // multiPrompt has fields {index, prompt, duration}. The parent's flag
    // (resolved via ALIAS_MAP — empty here, so default kebab 'multi-prompt')
    // becomes the prefix for each subfield flag.
    expect(flags['multi-prompt-index']).toBeDefined();
    expect(flags['multi-prompt-prompt']).toBeDefined();
    expect(flags['multi-prompt-duration']).toBeDefined();
  });

  it('every emitted subfield flag is multi (repeatable)', () => {
    expect(asShape(flags, 'multi-prompt-index').multiple).toBe(true);
    expect(asShape(flags, 'multi-prompt-prompt').multiple).toBe(true);
    expect(asShape(flags, 'multi-prompt-duration').multiple).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Multiple kinds together                                               */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — multiple kinds', () => {
  const cat = loadCatalog(
    [MODEL_ENUM_STRING, MODEL_BOOLEAN, MODEL_RANGE, MODEL_TEXT, MODEL_FILE, MODEL_OBJECT],
    ALIAS_MAP,
  );
  const flags = generateFlagsFromCatalog(cat);

  it('emits a flag for every kind, expanding objects to per-subfield flags', () => {
    const names = new Set(Object.keys(flags));
    expect(names.has('aspect-ratio')).toBe(true);
    expect(names.has('generate-audio')).toBe(true);
    expect(names.has('cfg-scale')).toBe(true);
    expect(names.has('prompt')).toBe(true);
    expect(names.has('image')).toBe(true); // file → path flag
    // object expands to per-subfield flags, not a single flag
    expect(names.has('multi-prompt')).toBe(false);
    expect(names.has('multi-prompt-prompt')).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Alias resolution end-to-end                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — alias resolution', () => {
  it('respects flag-override from ALIAS_MAP (videoUrl → --video)', () => {
    const customModel: ModelLike = {
      id: 'fx-custom',
      paramConfig: {
        videoUrl: { descriptor: { kind: 'text' } },
      },
    };
    const cat2 = loadCatalog([customModel], ALIAS_MAP);
    const flags = generateFlagsFromCatalog(cat2);
    // ALIAS_MAP: videoUrl → flag: 'video', aliases: ['vd']
    expect(flags.video).toBeDefined();
    expect(flags['video-url']).toBeUndefined();
    expect(asShape(flags, 'video').aliases).toContain('vd');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Real-SDK snapshot                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateFlagsFromCatalog — real SDK snapshot', () => {
  it('produces a stable flag set against the real catalog', async () => {
    const { getCatalog } = await import('../../02-catalog/index.ts');
    const flags = generateFlagsFromCatalog(getCatalog());

    // Serialize to a stable shape — only the observable properties.
    const serialized = Object.entries(flags)
      .map(([name, raw]) => {
        const f = raw as FlagShape;
        return {
          name,
          type: f.type ?? null,
          allowNo: f.allowNo ?? null,
          multiple: f.multiple ?? null,
          options: f.options ?? null,
          char: f.char ?? null,
          aliases: f.aliases ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    expect(serialized).toMatchSnapshot();
  });
});

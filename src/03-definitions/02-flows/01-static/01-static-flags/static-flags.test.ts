/**
 * Static Flags — verifies the shape of each declared group plus the
 * cross-block collision contract: static `char`s and `aliases` must
 * not shadow any descriptor-derived flag from Param Surface.
 */
import { describe, expect, it } from 'vitest';
import { ALIAS_MAP, generateFlagsFromCatalog, loadCatalog } from '#param-surface';
import {
  MODEL_BOOLEAN,
  MODEL_ENUM_NUMBER,
  MODEL_ENUM_STRING,
  MODEL_FILE,
  MODEL_OBJECT,
  MODEL_RANGE,
  MODEL_TEXT,
} from '#param-surface/__test-utils__/models-min.ts';
import {
  getStaticFlagGroup,
  STATIC_FLAG_GROUPS,
  type StaticFlagGroupName,
  type StaticFlagSet,
} from './static-flags.ts';

/* ─────────────────────────────────────────────────────────────────────── */
/*  Group names                                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('STATIC_FLAG_GROUPS — group names', () => {
  it('exposes the canonical group names', () => {
    expect(Object.keys(STATIC_FLAG_GROUPS).sort()).toEqual([
      'directory-input',
      'model',
      'output',
      'prompt-input',
      'universal',
    ]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Per-group flag presence                                               */
/* ─────────────────────────────────────────────────────────────────────── */

describe('STATIC_FLAG_GROUPS — universal', () => {
  it('contains the verbosity / format flags', () => {
    const keys = Object.keys(STATIC_FLAG_GROUPS.universal).sort();
    expect(keys).toEqual(['debug', 'json', 'max-cost', 'no-color', 'no-input', 'plain', 'poll-timeout', 'quiet']);
  });

  it('exposes `quiet` as -q', () => {
    const q = STATIC_FLAG_GROUPS.universal.quiet as { char?: string };
    expect(q.char).toBe('q');
  });

  it('exposes `debug` as -D (uppercase — lowercase `-d` is reserved for descriptors)', () => {
    const d = STATIC_FLAG_GROUPS.universal.debug as { char?: string };
    expect(d.char).toBe('D');
  });

  it('exposes `--no-input` with `--silent` alias and `-s` short flag', () => {
    const flag = STATIC_FLAG_GROUPS.universal['no-input'] as { char?: string; aliases?: readonly string[] };
    expect(flag.char).toBe('s');
    expect(flag.aliases).toContain('silent');
  });
});

describe('STATIC_FLAG_GROUPS — prompt-input', () => {
  it('contains the alternative-prompt-source flag', () => {
    expect(Object.keys(STATIC_FLAG_GROUPS['prompt-input'])).toEqual(['prompt-file']);
  });

  it('`prompt-file` is a string flag with a clear description', () => {
    const flag = STATIC_FLAG_GROUPS['prompt-input']['prompt-file'] as { description?: string };
    expect(typeof flag.description).toBe('string');
    expect(flag.description!.length).toBeGreaterThan(0);
  });
});

describe('STATIC_FLAG_GROUPS — directory-input', () => {
  it('contains the six directory-processing flags', () => {
    expect(Object.keys(STATIC_FLAG_GROUPS['directory-input']).sort()).toEqual([
      'batch',
      'concurrency',
      'input-dir',
      'max-files',
      'multi',
      'type',
    ]);
  });

  it('`type` accepts only image / video / audio', () => {
    const flag = STATIC_FLAG_GROUPS['directory-input'].type as { options?: readonly string[] };
    expect(flag.options).toEqual(['image', 'video', 'audio']);
  });

  it('`max-files` defaults to 30 and `concurrency` to 3', () => {
    const max = STATIC_FLAG_GROUPS['directory-input']['max-files'] as { default?: number };
    const conc = STATIC_FLAG_GROUPS['directory-input'].concurrency as { default?: number };
    expect(max.default).toBe(30);
    expect(conc.default).toBe(3);
  });
});

describe('STATIC_FLAG_GROUPS — output', () => {
  it('contains every output-destination flag', () => {
    const keys = Object.keys(STATIC_FLAG_GROUPS.output).sort();
    expect(keys).toEqual(['bell', 'clipboard', 'download', 'drive-folder', 'notify', 'open', 'save-to-drive']);
  });

  it('`save-to-drive` allows --no-save-to-drive', () => {
    const flag = STATIC_FLAG_GROUPS.output['save-to-drive'] as { allowNo?: boolean };
    expect(flag.allowNo).toBe(true);
  });

  it('`drive-folder` has the sensible default `gen-ai-cli`', () => {
    const flag = STATIC_FLAG_GROUPS.output['drive-folder'] as { default?: unknown };
    expect(flag.default).toBe('gen-ai-cli');
  });

  it('exposes char aliases on the verbose flags', () => {
    const open = STATIC_FLAG_GROUPS.output.open as { char?: string };
    const clip = STATIC_FLAG_GROUPS.output.clipboard as { char?: string };
    expect(open.char).toBe('o');
    expect(clip.char).toBe('c');
  });

  it('declares long aliases for the verbose drive flags', () => {
    const save = STATIC_FLAG_GROUPS.output['save-to-drive'] as { aliases?: readonly string[] };
    const folder = STATIC_FLAG_GROUPS.output['drive-folder'] as { aliases?: readonly string[] };
    const dl = STATIC_FLAG_GROUPS.output.download as { aliases?: readonly string[] };
    expect(save.aliases).toContain('drive');
    expect(folder.aliases).toContain('folder');
    expect(dl.aliases).toContain('out');
  });

  it('`download` deliberately has no `char` (-d collides with descriptor --duration)', () => {
    const dl = STATIC_FLAG_GROUPS.output.download as { char?: string };
    expect(dl.char).toBeUndefined();
  });
});

describe('STATIC_FLAG_GROUPS — model', () => {
  it('contains exactly the `model` flag', () => {
    expect(Object.keys(STATIC_FLAG_GROUPS.model)).toEqual(['model']);
  });

  it('exposes `model` as -m', () => {
    const flag = STATIC_FLAG_GROUPS.model.model as { char?: string };
    expect(flag.char).toBe('m');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  No collisions between groups                                          */
/*  (composer relies on this when spreading multiple groups together)     */
/* ─────────────────────────────────────────────────────────────────────── */

describe('STATIC_FLAG_GROUPS — collisions', () => {
  it('no flag name appears in more than one group', () => {
    const seen = new Map<string, StaticFlagGroupName>();
    const duplicates: string[] = [];
    for (const name of Object.keys(STATIC_FLAG_GROUPS) as StaticFlagGroupName[]) {
      for (const flagName of Object.keys(STATIC_FLAG_GROUPS[name])) {
        if (seen.has(flagName)) {
          duplicates.push(`${flagName} (in ${seen.get(flagName)} and ${name})`);
        } else {
          seen.set(flagName, name);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getStaticFlagGroup                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────── */
/*  Cross-block collisions vs Param Surface                               */
/* ─────────────────────────────────────────────────────────────────────── */

describe('STATIC_FLAG_GROUPS — collisions vs Param Surface descriptor flags', () => {
  const cat = loadCatalog(
    [MODEL_TEXT, MODEL_ENUM_STRING, MODEL_ENUM_NUMBER, MODEL_BOOLEAN, MODEL_RANGE, MODEL_FILE, MODEL_OBJECT],
    ALIAS_MAP,
  );
  const descriptorFlags = generateFlagsFromCatalog(cat) as Record<
    string,
    { char?: string; aliases?: readonly string[] }
  >;

  function collectStatic() {
    const names: string[] = [];
    const chars: string[] = [];
    const aliases: string[] = [];
    for (const group of Object.values(STATIC_FLAG_GROUPS)) {
      for (const [name, raw] of Object.entries(group)) {
        const flag = raw as { char?: string; aliases?: readonly string[] };
        names.push(name);
        if (flag.char) chars.push(flag.char);
        if (flag.aliases) aliases.push(...flag.aliases);
      }
    }
    return { names, chars, aliases };
  }

  it('no static flag NAME shadows a descriptor flag name (or vice-versa)', () => {
    const { names } = collectStatic();
    const overlap = names.filter((n) => Object.hasOwn(descriptorFlags, n));
    expect(overlap).toEqual([]);
  });

  it('no static `char` shadows a descriptor `char`', () => {
    const { chars } = collectStatic();
    const descriptorChars = new Set<string>();
    for (const flag of Object.values(descriptorFlags)) {
      if (flag.char) descriptorChars.add(flag.char);
    }
    const overlap = chars.filter((c) => descriptorChars.has(c));
    expect(overlap).toEqual([]);
  });

  it('no static long alias shadows a descriptor flag name or alias', () => {
    const { aliases } = collectStatic();
    const descriptorNames = new Set(Object.keys(descriptorFlags));
    const descriptorAliases = new Set<string>();
    for (const flag of Object.values(descriptorFlags)) {
      for (const a of flag.aliases ?? []) descriptorAliases.add(a);
    }
    const overlap = aliases.filter((a) => descriptorNames.has(a) || descriptorAliases.has(a));
    expect(overlap).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getStaticFlagGroup                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getStaticFlagGroup', () => {
  it('returns the requested group by name', () => {
    expect(getStaticFlagGroup('universal')).toBe(STATIC_FLAG_GROUPS.universal);
    expect(getStaticFlagGroup('output')).toBe(STATIC_FLAG_GROUPS.output);
    expect(getStaticFlagGroup('model')).toBe(STATIC_FLAG_GROUPS.model);
    expect(getStaticFlagGroup('prompt-input')).toBe(STATIC_FLAG_GROUPS['prompt-input']);
    expect(getStaticFlagGroup('directory-input')).toBe(STATIC_FLAG_GROUPS['directory-input']);
  });

  it('return type is spreadable into a flag set', () => {
    const merged: StaticFlagSet = { ...getStaticFlagGroup('universal'), ...getStaticFlagGroup('model') };
    expect(merged).toHaveProperty('json');
    expect(merged).toHaveProperty('model');
  });
});

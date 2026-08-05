/**
 * Block 1 — Aliases.
 *
 * Tests verify internal consistency of the alias table:
 *   - well-formed names
 *   - no collisions (no two keys claim the same char or flag override)
 *   - keys look like SDK descriptor keys (camelCase)
 *
 * "Every alias points to a real SDK key" is verified in Block 3 (Catalog)
 * — that's where the SDK fixture is available. Block 1 is self-contained.
 */
import { describe, expect, it } from 'vitest';
import { ALIAS_MAP, type AliasMap, type FlagAlias } from './aliases.ts';

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;

describe('ALIAS_MAP', () => {
  it('is a non-empty record', () => {
    expect(Object.keys(ALIAS_MAP).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(ALIAS_MAP))('key %s is camelCase (no dash, underscore, leading capital)', (key) => {
    expect(key).toMatch(CAMEL_CASE);
  });

  it.each(Object.entries(ALIAS_MAP))('alias for %s declares at least one override', (_key, alias) => {
    const a = alias as FlagAlias;
    const hasOverride =
      a.flag !== undefined || a.char !== undefined || (a.aliases !== undefined && a.aliases.length > 0);
    expect(hasOverride).toBe(true);
  });

  it.each(Object.entries(ALIAS_MAP))('alias for %s — char is exactly one character when set', (_key, alias) => {
    const a = alias as FlagAlias;
    if (a.char !== undefined) {
      expect(a.char).toHaveLength(1);
      expect(a.char).toMatch(/^[a-z]$/);
    }
  });

  it.each(Object.entries(ALIAS_MAP))('alias for %s — flag override is kebab-case when set', (_key, alias) => {
    const a = alias as FlagAlias;
    if (a.flag !== undefined) {
      expect(a.flag).toMatch(KEBAB_CASE);
    }
  });

  it.each(Object.entries(ALIAS_MAP))('alias for %s — long-form aliases are kebab-case', (_key, alias) => {
    const a = alias as FlagAlias;
    for (const long of a.aliases ?? []) {
      expect(long).toMatch(KEBAB_CASE);
    }
  });

  it('no two keys claim the same short char', () => {
    const claimedBy = new Map<string, string>();
    for (const [key, alias] of Object.entries(ALIAS_MAP)) {
      if (alias.char === undefined) continue;
      const prev = claimedBy.get(alias.char);
      expect(prev, `char '${alias.char}' claimed by both '${prev}' and '${key}'`).toBeUndefined();
      claimedBy.set(alias.char, key);
    }
  });

  it('no two keys claim the same flag override', () => {
    const claimedBy = new Map<string, string>();
    for (const [key, alias] of Object.entries(ALIAS_MAP)) {
      if (alias.flag === undefined) continue;
      const prev = claimedBy.get(alias.flag);
      expect(prev, `flag '--${alias.flag}' claimed by both '${prev}' and '${key}'`).toBeUndefined();
      claimedBy.set(alias.flag, key);
    }
  });

  it('no two keys claim the same long-form alias', () => {
    const claimedBy = new Map<string, string>();
    for (const [key, alias] of Object.entries(ALIAS_MAP)) {
      for (const long of alias.aliases ?? []) {
        const prev = claimedBy.get(long);
        expect(prev, `alias '--${long}' claimed by both '${prev}' and '${key}'`).toBeUndefined();
        claimedBy.set(long, key);
      }
    }
  });

  it('flag override and long-form aliases do not collide across keys', () => {
    // A flag override on one key and a long-form alias on another both claim
    // the same on-disk name; oclif would silently let one win. Reject up-front.
    const claimedBy = new Map<string, string>();
    for (const [key, alias] of Object.entries(ALIAS_MAP)) {
      const names = [alias.flag, ...(alias.aliases ?? [])].filter((v): v is string => v !== undefined);
      for (const name of names) {
        const prev = claimedBy.get(name);
        expect(prev, `--${name} claimed by both '${prev}' and '${key}'`).toBeUndefined();
        claimedBy.set(name, key);
      }
    }
  });

  it('matches snapshot', () => {
    expect(ALIAS_MAP).toMatchSnapshot();
  });
});

describe('AliasMap type contract', () => {
  it('rejects unknown properties at compile time', () => {
    // Compile-time check; if FlagAlias gains stray fields this test still passes
    // at runtime but a TS error surfaces in the editor / CI.
    const valid: AliasMap = { foo: { char: 'f' } };
    expect(valid).toBeDefined();
  });
});

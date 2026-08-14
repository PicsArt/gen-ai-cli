/**
 * Color manager — enable/disable toggle, ANSI stripping, env detection.
 * Migrated from `__tests__/unit/color-manager.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { createColorManager } from './color.ts';

describe('createColorManager — disabled', () => {
  it('returns plain strings for every color helper', () => {
    const c = createColorManager({ enabled: false });
    expect(c.red('hello')).toBe('hello');
    expect(c.green('world')).toBe('world');
    expect(c.bold('text')).toBe('text');
    expect(c.dim('faded')).toBe('faded');
    expect(c.brand('logo')).toBe('logo');
  });
});

describe('createColorManager — enabled', () => {
  it('wraps text with ANSI escape sequences', () => {
    const c = createColorManager({ enabled: true });
    const result = c.red('error');
    expect(result).not.toBe('error');
    expect(result).toContain('error');
    expect(result).toContain('\x1b[');
  });

  it('strip() removes ANSI escape sequences', () => {
    const c = createColorManager({ enabled: true });
    expect(c.strip(c.red('hello'))).toBe('hello');
  });
});

describe('createColorManager — strip on plain text', () => {
  it('is a no-op when text has no escape sequences', () => {
    const c = createColorManager({ enabled: false });
    expect(c.strip('hello')).toBe('hello');
  });
});

describe('createColorManager — noColorFlag', () => {
  it('disables color even when enabled=true', () => {
    const c = createColorManager({ enabled: true, noColorFlag: true });
    expect(c.enabled).toBe(false);
    expect(c.red('text')).toBe('text');
  });
});

describe('createColorManager — enabled helpers', () => {
  it('link() wraps text in an OSC 8 hyperlink', () => {
    const c = createColorManager({ enabled: true });
    const linked = c.link('label', 'https://example.com');
    expect(linked).toContain(']8;;https://example.com');
    expect(linked).toContain('label');
    expect(c.strip(linked)).toBe('label');
  });

  it('hex() produces a color wrapper that strip() can undo', () => {
    const c = createColorManager({ enabled: true });
    const colored = c.hex('#E859B4')('brand');
    expect(colored).toContain('brand');
    expect(c.strip(colored)).toBe('brand');
  });

  it('semantic helpers (success/error/warning/info) keep the text intact', () => {
    const c = createColorManager({ enabled: true });
    for (const helper of [c.success, c.error, c.warning, c.info] as const) {
      expect(c.strip(helper('msg'))).toBe('msg');
    }
  });
});

describe('createColorManager — env auto-detection', () => {
  it('respects NO_COLOR env variable', () => {
    const orig = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      const c = createColorManager({ enabled: 'auto' });
      expect(c.red('hello')).toBe('hello');
    } finally {
      if (orig === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = orig;
    }
  });

  it('respects TERM=dumb', () => {
    const orig = process.env.TERM;
    process.env.TERM = 'dumb';
    try {
      const c = createColorManager({ enabled: 'auto' });
      expect(c.red('hello')).toBe('hello');
    } finally {
      if (orig === undefined) delete process.env.TERM;
      else process.env.TERM = orig;
    }
  });
});

/**
 * Spec for user-config service.
 *
 * Contract:
 *   - getUserConfig() returns defaults when no file exists.
 *   - saveUserConfig() persists to ~/.gen-ai/config.json with 0o600 perms.
 *   - get + set round-trip preserves values.
 *   - setConfigValue() validates type per key (string/number/boolean).
 *   - setConfigValue() coerces 'true'/'1' to boolean true.
 *   - Unknown keys are rejected with { ok: false }.
 *   - Numeric keys (recentFilesCount) enforce 1..500 range.
 *   - downloadDir must be an absolute path.
 *   - unsetConfigValue() removes a key from the persisted config.
 *   - getConfigKeys() lists every valid config key.
 *   - Corrupt/missing file silently returns defaults.
 *   - Persisted values with wrong type are silently dropped.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigKeys, getUserConfig, saveUserConfig, setConfigValue, unsetConfigValue } from './user-config.ts';

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-cfg-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});
afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const cfgPath = () => path.join(tmpHome, '.gen-ai', 'config.json');

/* ─────────────────────────────────────────────────────────────────────── */
/*  Defaults                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getUserConfig — defaults', () => {
  it('returns autoUpdate: true when no config file exists', () => {
    expect(getUserConfig().autoUpdate).toBe(true);
  });

  it('returns the defaults object without other keys populated', () => {
    const cfg = getUserConfig();
    expect(cfg.defaultModel).toBeUndefined();
    expect(cfg.downloadDir).toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Persistence + round-trip                                              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('saveUserConfig / getUserConfig round-trip', () => {
  it('persists every key', () => {
    saveUserConfig({
      defaultModel: 'flux-pro',
      downloadDir: '/tmp/out',
      autoOpen: true,
      autoClipboard: false,
      autoBell: true,
      autoNotify: false,
      recentFilesCount: 5,
      imagePreview: true,
      autoUpdate: false,
    });
    const cfg = getUserConfig();
    expect(cfg.defaultModel).toBe('flux-pro');
    expect(cfg.downloadDir).toBe('/tmp/out');
    expect(cfg.autoOpen).toBe(true);
    expect(cfg.autoClipboard).toBe(false);
    expect(cfg.recentFilesCount).toBe(5);
    expect(cfg.autoUpdate).toBe(false);
  });

  it('writes config.json with 0o600 permissions', () => {
    saveUserConfig({ defaultModel: 'x' });
    const mode = fs.statSync(cfgPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  setConfigValue                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('setConfigValue', () => {
  it('rejects unknown keys', () => {
    const result = setConfigValue('bogus', 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown/i);
  });

  it('coerces "true" / "1" / "yes" / "on" to boolean true', () => {
    expect(setConfigValue('autoOpen', 'true').ok).toBe(true);
    expect(getUserConfig().autoOpen).toBe(true);
    expect(setConfigValue('autoClipboard', '1').ok).toBe(true);
    expect(getUserConfig().autoClipboard).toBe(true);
    expect(setConfigValue('autoBell', 'yes').ok).toBe(true);
    expect(getUserConfig().autoBell).toBe(true);
    expect(setConfigValue('autoNotify', 'ON').ok).toBe(true);
    expect(getUserConfig().autoNotify).toBe(true);
  });

  it('coerces "false" / "0" / "no" / "off" to boolean false', () => {
    expect(setConfigValue('autoOpen', 'false').ok).toBe(true);
    expect(getUserConfig().autoOpen).toBe(false);
    expect(setConfigValue('autoClipboard', '0').ok).toBe(true);
    expect(getUserConfig().autoClipboard).toBe(false);
    expect(setConfigValue('autoBell', 'off').ok).toBe(true);
    expect(getUserConfig().autoBell).toBe(false);
  });

  it('rejects unrecognized boolean strings instead of silently storing false', () => {
    // Regression: "yes" and typos like "ture" used to be silently coerced to
    // false — the opposite of what the user meant.
    const result = setConfigValue('autoOpen', 'maybe');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/true or false/i);
    expect(getUserConfig().autoOpen).toBeUndefined();
  });

  it('parses numbers, enforces 1..500 range', () => {
    expect(setConfigValue('recentFilesCount', '10').ok).toBe(true);
    expect(getUserConfig().recentFilesCount).toBe(10);

    const tooHigh = setConfigValue('recentFilesCount', '501');
    expect(tooHigh.ok).toBe(false);
    const tooLow = setConfigValue('recentFilesCount', '0');
    expect(tooLow.ok).toBe(false);
    const nan = setConfigValue('recentFilesCount', 'abc');
    expect(nan.ok).toBe(false);
  });

  it('downloadDir requires an absolute path', () => {
    expect(setConfigValue('downloadDir', './relative').ok).toBe(false);
    expect(setConfigValue('downloadDir', '').ok).toBe(false);
    expect(setConfigValue('downloadDir', '/abs/path').ok).toBe(true);
    expect(getUserConfig().downloadDir).toBe('/abs/path');
  });

  it('accepts free-form strings for other string keys', () => {
    expect(setConfigValue('defaultModel', 'flux-pro').ok).toBe(true);
    expect(getUserConfig().defaultModel).toBe('flux-pro');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  unsetConfigValue                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('unsetConfigValue', () => {
  it('removes a previously set key', () => {
    setConfigValue('defaultModel', 'flux-pro');
    expect(getUserConfig().defaultModel).toBe('flux-pro');
    expect(unsetConfigValue('defaultModel')).toBe(true);
    expect(getUserConfig().defaultModel).toBeUndefined();
  });

  it('returns false for unknown keys', () => {
    expect(unsetConfigValue('bogus')).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getConfigKeys                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getConfigKeys', () => {
  it('lists every defined config key', () => {
    const keys = getConfigKeys();
    expect(keys).toContain('defaultModel');
    expect(keys).toContain('downloadDir');
    expect(keys).toContain('autoOpen');
    expect(keys).toContain('autoUpdate');
    expect(keys).toContain('recentFilesCount');
  });

  it('returns a fresh array (caller can mutate without affecting internals)', () => {
    const k1 = getConfigKeys();
    k1.push('extra');
    const k2 = getConfigKeys();
    expect(k2).not.toContain('extra');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Resilience                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getUserConfig — resilience', () => {
  it('returns defaults silently when the file is corrupt', () => {
    fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
    fs.writeFileSync(cfgPath(), '{ not valid json');
    expect(getUserConfig().autoUpdate).toBe(true);
  });

  it('silently drops persisted values with the wrong type', () => {
    fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
    fs.writeFileSync(
      cfgPath(),
      JSON.stringify({
        defaultModel: 42, // should be string — drop
        autoOpen: 'yes', // should be boolean — drop
        recentFilesCount: '5', // should be number — drop
        autoBell: true, // valid
      }),
    );
    const cfg = getUserConfig();
    expect(cfg.defaultModel).toBeUndefined();
    expect(cfg.autoOpen).toBeUndefined();
    expect(cfg.recentFilesCount).toBeUndefined();
    expect(cfg.autoBell).toBe(true);
  });
});

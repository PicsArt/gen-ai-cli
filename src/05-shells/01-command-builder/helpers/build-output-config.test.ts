/**
 * Spec for buildOutputConfig.
 *
 * Contract:
 *   buildOutputConfig(flags, userConfig, modeFlags) → OutputConfig
 *
 *   - flags override userConfig defaults
 *   - download: --no-download wins; else --download; else userConfig.downloadDir; else './output'
 *   - driveSave: defaults to true; --save-to-drive=false flips it
 *   - boolean side-effects (clipboard/bell/notify) OR-merge flags with userConfig
 *   - open: explicit flag wins (including `false`); else userConfig.autoOpen ?? false
 *   - modeFlags pass through verbatim (jsonMode / quietMode / plainMode)
 */
import { describe, expect, it, vi } from 'vitest';
import type { UserConfig } from '#services/user-config.ts';

vi.mock('#services/constants.ts', () => ({ resolveUserPath: (p: string) => `RES:${p}` }));

import { buildOutputConfig } from './build-output-config.ts';

const noModes = { json: false, quiet: false, plain: false };

function userConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return overrides as UserConfig;
}

describe('buildOutputConfig — download path', () => {
  it('uses --no-download to disable download entirely', () => {
    const out = buildOutputConfig({ 'no-download': true, download: './ignored' }, userConfig(), noModes);
    expect(out.download).toBeUndefined();
  });

  it('uses --download when provided (resolved through resolveUserPath)', () => {
    const out = buildOutputConfig({ download: './out' }, userConfig(), noModes);
    expect(out.download).toBe('RES:./out');
  });

  it('falls back to userConfig.downloadDir when no flag is set', () => {
    const out = buildOutputConfig({}, userConfig({ downloadDir: '~/downloads' }), noModes);
    expect(out.download).toBe('RES:~/downloads');
  });

  it('defaults to ./output when neither flag nor userConfig sets it', () => {
    const out = buildOutputConfig({}, userConfig(), noModes);
    expect(out.download).toBe('./output');
  });
});

describe('buildOutputConfig — drive', () => {
  it('driveSave defaults to true when the flag is absent', () => {
    const out = buildOutputConfig({}, userConfig(), noModes);
    expect(out.driveSave).toBe(true);
  });

  it('driveSave honors an explicit false (--no-save-to-drive)', () => {
    const out = buildOutputConfig({ 'save-to-drive': false }, userConfig(), noModes);
    expect(out.driveSave).toBe(false);
  });

  it('driveFolder defaults to "gen-ai-cli"', () => {
    const out = buildOutputConfig({}, userConfig(), noModes);
    expect(out.driveFolder).toBe('gen-ai-cli');
  });

  it('driveFolder honors --drive-folder', () => {
    const out = buildOutputConfig({ 'drive-folder': 'my-stuff' }, userConfig(), noModes);
    expect(out.driveFolder).toBe('my-stuff');
  });
});

describe('buildOutputConfig — side-effect flags', () => {
  it('clipboard OR-merges flag with userConfig.autoClipboard', () => {
    expect(buildOutputConfig({ clipboard: true }, userConfig(), noModes).clipboard).toBe(true);
    expect(buildOutputConfig({}, userConfig({ autoClipboard: true }), noModes).clipboard).toBe(true);
    expect(buildOutputConfig({}, userConfig(), noModes).clipboard).toBe(false);
  });

  it('bell OR-merges flag with userConfig.autoBell', () => {
    expect(buildOutputConfig({ bell: true }, userConfig(), noModes).bell).toBe(true);
    expect(buildOutputConfig({}, userConfig({ autoBell: true }), noModes).bell).toBe(true);
  });

  it('notify OR-merges flag with userConfig.autoNotify', () => {
    expect(buildOutputConfig({ notify: true }, userConfig(), noModes).notify).toBe(true);
    expect(buildOutputConfig({}, userConfig({ autoNotify: true }), noModes).notify).toBe(true);
  });

  it('open: explicit flag wins, even when it is false', () => {
    expect(buildOutputConfig({ open: true }, userConfig({ autoOpen: false }), noModes).open).toBe(true);
    expect(buildOutputConfig({ open: false }, userConfig({ autoOpen: true }), noModes).open).toBe(false);
    expect(buildOutputConfig({}, userConfig({ autoOpen: true }), noModes).open).toBe(true);
    expect(buildOutputConfig({}, userConfig(), noModes).open).toBe(false);
  });
});

describe('buildOutputConfig — modeFlags passthrough', () => {
  it('forwards json / quiet / plain into the *Mode fields verbatim', () => {
    const out = buildOutputConfig({}, userConfig(), { json: true, quiet: true, plain: false });
    expect(out.jsonMode).toBe(true);
    expect(out.quietMode).toBe(true);
    expect(out.plainMode).toBe(false);
  });
});

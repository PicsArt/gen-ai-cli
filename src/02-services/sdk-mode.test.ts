import { afterEach, describe, expect, it } from 'vitest';
import {
  getSdkMode,
  isDynamicSdk,
  isSdkModeResolved,
  requestedSdkMode,
  resetSdkModeForTests,
  setSdkMode,
} from './sdk-mode.ts';

afterEach(() => resetSdkModeForTests());

describe('sdk-mode', () => {
  it('is static and unresolved before boot', () => {
    expect(getSdkMode()).toBe('static');
    expect(isDynamicSdk()).toBe(false);
    expect(isSdkModeResolved()).toBe(false);
  });

  it('fixes the mode once and refuses a flip', () => {
    setSdkMode('dynamic');
    expect(getSdkMode()).toBe('dynamic');
    expect(isDynamicSdk()).toBe(true);
    setSdkMode('dynamic');
    expect(() => setSdkMode('static')).toThrow(/already "dynamic"/);
  });

  it.each([
    [undefined, 'dynamic'],
    ['dynamic', 'dynamic'],
    ['static', 'static'],
    [' STATIC ', 'static'],
    ['nonsense', 'dynamic'],
  ])('GEN_AI_SDK_MODE=%s requests %s', (value, expected) => {
    expect(requestedSdkMode(value === undefined ? {} : { GEN_AI_SDK_MODE: value })).toBe(expected);
  });
});

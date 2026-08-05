/**
 * Spec for nav prompt helpers.
 *
 * Contract for the pure helper exported by `nav.ts`:
 *   injectNavChoices(choices, opts?):
 *     - appends [separator, ←Back, ✕Cancel] to the choice list
 *     - omits ←Back when `cancelOnly: true`
 *     - returns a NEW array (no mutation of input)
 *
 * The interactive prompts (selectWithNav / searchWithNav / confirmWithNav /
 * askWithNav) wrap inquirer + stdin and are exercised via the runtime smoke
 * tests, not here.
 */
import { describe, expect, it } from 'vitest';
import { injectNavChoices, NAV_SEPARATOR } from './nav.ts';
import { BACK, CANCEL } from './wizard-state.ts';

describe('injectNavChoices', () => {
  it('appends separator + Back + Cancel by default', () => {
    const input = [{ name: 'one', value: 1 }];
    const out = injectNavChoices(input);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual(input[0]);
    expect(out[1]).toBe(NAV_SEPARATOR);
    expect(out[2]?.value).toBe(BACK);
    expect(out[3]?.value).toBe(CANCEL);
  });

  it('omits Back when cancelOnly is true', () => {
    const out = injectNavChoices([{ name: 'one', value: 1 }], { cancelOnly: true });
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(NAV_SEPARATOR);
    expect(out[2]?.value).toBe(CANCEL);
  });

  it('does not mutate the caller-owned array', () => {
    const input = [{ name: 'one', value: 1 }];
    const before = input.length;
    injectNavChoices(input);
    expect(input).toHaveLength(before);
  });

  it('handles an empty choices array', () => {
    const out = injectNavChoices<number>([]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(NAV_SEPARATOR);
    expect(out[1]?.value).toBe(BACK);
    expect(out[2]?.value).toBe(CANCEL);
  });
});

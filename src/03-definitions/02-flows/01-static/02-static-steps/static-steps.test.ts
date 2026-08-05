/**
 * Static Steps — verifies the shape of each declared group. Pure data;
 * tests exist to lock the public surface and catch key collisions
 * between groups.
 */
import { describe, expect, it } from 'vitest';
import type { WizardStep } from '#param-surface';
import { getStaticStepGroup, STATIC_STEP_GROUPS, type StaticStepGroupName } from './static-steps.ts';

/* ─────────────────────────────────────────────────────────────────────── */
/*  Group names                                                           */
/* ─────────────────────────────────────────────────────────────────────── */

describe('STATIC_STEP_GROUPS — group names', () => {
  it('exposes the canonical group names', () => {
    expect(Object.keys(STATIC_STEP_GROUPS).sort()).toEqual(['confirm', 'output']);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Per-group step keys                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

describe('STATIC_STEP_GROUPS — output', () => {
  it('contains the download / drive prompts in a sensible order', () => {
    const keys = STATIC_STEP_GROUPS.output.map((s) => s.key);
    expect(keys).toEqual(['downloadPath', 'saveToDrive', 'driveFolder']);
  });

  it('saveToDrive defaults to true (CLI users usually want this)', () => {
    const s = STATIC_STEP_GROUPS.output.find((x) => x.key === 'saveToDrive');
    expect(s?.kind).toBe('confirm');
    if (s?.kind !== 'confirm') throw new Error('expected confirm');
    expect(s.default).toBe(true);
  });
});

describe('STATIC_STEP_GROUPS — confirm', () => {
  it('contains exactly the proceed step', () => {
    expect(STATIC_STEP_GROUPS.confirm.map((s) => s.key)).toEqual(['proceed']);
  });

  it('proceed is required and defaults to true', () => {
    const [s] = STATIC_STEP_GROUPS.confirm;
    if (s.kind !== 'confirm') throw new Error('expected confirm');
    expect(s.required).toBe(true);
    expect(s.default).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  No key collisions between groups                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('STATIC_STEP_GROUPS — key collisions', () => {
  it('no step key appears in more than one group', () => {
    const seen = new Map<string, StaticStepGroupName>();
    const duplicates: string[] = [];
    for (const name of Object.keys(STATIC_STEP_GROUPS) as StaticStepGroupName[]) {
      for (const step of STATIC_STEP_GROUPS[name]) {
        if (seen.has(step.key)) {
          duplicates.push(`${step.key} (in ${seen.get(step.key)} and ${name})`);
        } else {
          seen.set(step.key, name);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Shape compatibility with WizardStep                                   */
/* ─────────────────────────────────────────────────────────────────────── */

describe('STATIC_STEP_GROUPS — type compatibility', () => {
  it('every static step is structurally a WizardStep', () => {
    const allSteps: WizardStep[] = [...STATIC_STEP_GROUPS.output, ...STATIC_STEP_GROUPS.confirm];
    for (const step of allSteps) {
      expect(typeof step.key).toBe('string');
      expect(typeof step.label).toBe('string');
      expect(['text', 'select', 'number', 'confirm', 'object']).toContain(step.kind);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getStaticStepGroup                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getStaticStepGroup', () => {
  it('returns the requested group by name', () => {
    expect(getStaticStepGroup('output')).toBe(STATIC_STEP_GROUPS.output);
    expect(getStaticStepGroup('confirm')).toBe(STATIC_STEP_GROUPS.confirm);
  });

  it('return type is spreadable into a wizard step list', () => {
    const merged: WizardStep[] = [...getStaticStepGroup('output'), ...getStaticStepGroup('confirm')];
    expect(merged.map((s) => s.key)).toContain('downloadPath');
    expect(merged.map((s) => s.key)).toContain('proceed');
  });
});

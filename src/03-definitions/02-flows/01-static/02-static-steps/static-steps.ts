/**
 * Static Steps — hand-maintained groups of wizard steps that have no
 * SDK descriptor source.
 *
 * The wizard-side twin of `static-flags.ts`. Where static flags describe
 * what an oclif command accepts on the command line, static steps
 * describe what the interactive wizard runner prompts for *outside* of
 * the descriptor-derived per-param questions.
 *
 * Each group is a `readonly WizardStep[]` — the same `WizardStep` type
 * Param Surface's `wizard-schema` emits. That way the composer can
 * concat descriptor-derived steps with static groups and hand a single
 * uniform array to the runner. No type adapters needed.
 *
 * The composer decides WHERE each group goes (before / between / after
 * the descriptor steps). This sub-part has no opinion on order — it's
 * pure data, keyed by group name.
 *
 * Notable omission: the **model picker** is NOT here. It needs the
 * filtered model list at compose time (its `choices` come from the
 * runtime catalog), so it lives next to the wizard composer where that
 * data is available. Static = "fully self-contained at module load."
 */
import type { WizardStep } from '#param-surface';

export type StaticStepGroup = readonly WizardStep[];

/* ─────────────────────────────────────────────────────────────────────── */
/*  Group: output                                                         */
/*  Where the result should land (downloaded file, Drive, etc.).          */
/* ─────────────────────────────────────────────────────────────────────── */

const output: StaticStepGroup = [
  {
    kind: 'text',
    key: 'downloadPath',
    label: 'Download path (leave empty to skip)',
  },
  {
    kind: 'confirm',
    key: 'saveToDrive',
    label: 'Save result to Picsart Drive?',
    default: true,
  },
  {
    kind: 'text',
    key: 'driveFolder',
    label: 'Drive subfolder (default: gen-ai-cli)',
  },
];

/* ─────────────────────────────────────────────────────────────────────── */
/*  Group: confirm                                                        */
/*  Final yes/no before the generation runs.                              */
/* ─────────────────────────────────────────────────────────────────────── */

const confirm: StaticStepGroup = [
  {
    kind: 'confirm',
    key: 'proceed',
    label: 'Proceed with generation?',
    default: true,
    required: true,
  },
];

/* ─────────────────────────────────────────────────────────────────────── */
/*  Registry                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

export const STATIC_STEP_GROUPS = {
  output,
  confirm,
} as const;

export type StaticStepGroupName = keyof typeof STATIC_STEP_GROUPS;

/**
 * Look up a named step group. Returns the group's array for splicing
 * into the composed wizard step list.
 */
export function getStaticStepGroup(name: StaticStepGroupName): StaticStepGroup {
  return STATIC_STEP_GROUPS[name];
}

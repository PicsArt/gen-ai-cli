/**
 * Wizard Schema — descriptor → declarative wizard step.
 *
 * The describe-half twin of flag-schema. Where flag-schema produces an
 * oclif Flag set for scripted invocation, this produces a declarative
 * `WizardStep[]` for interactive prompting. Prompt-library agnostic:
 * inquirer, prompts, enquirer, or a custom TUI can all consume it.
 *
 * The interpret-half (`04-interpret/02-wizard-reader/`, future) reads
 * the user's answers back into a generation context.
 *
 * Kind table:
 *   text         → { kind: 'text', minLength?, maxLength? }
 *   enum         → { kind: 'select', choices: [{id,label}], default? }
 *   range        → { kind: 'number', min, max, default? }
 *   boolean      → { kind: 'confirm', default? }
 *   file         → skipped (file pipeline owns these)
 *   object       → { kind: 'object', fields: WizardStep[], arrayMax? }
 *
 * Top-level steps inherit `required` from
 * `surface.requiredInModels.length > 0`. Subfield steps (inside an
 * object) inherit `required` from "the subfield has no default" — the
 * same rule the interpret-half uses to decide whether to throw.
 *
 * Order: emitted in `catalog.all()` order, file kinds removed. Step
 * insertion / reordering is a composition-layer concern (e.g. a
 * downstream wizard-runner block) — wizard-schema stays pure.
 */
import type { EnumDescriptor, FileDescriptor, ObjectDescriptor, ParamDescriptor } from '@picsart/ai-sdk';
import type { Catalog, ParamSurface } from '../../02-catalog/index.ts';

export type SelectChoice<T extends string | number> = {
  id: T;
  label: string;
};

export type WizardStep =
  | { kind: 'text'; key: string; label: string; required?: boolean; minLength?: number; maxLength?: number }
  | {
      kind: 'select';
      key: string;
      label: string;
      required?: boolean;
      choices: ReadonlyArray<SelectChoice<string>> | ReadonlyArray<SelectChoice<number>>;
      default?: string | number;
    }
  | { kind: 'number'; key: string; label: string; required?: boolean; min: number; max: number; default?: number }
  | { kind: 'confirm'; key: string; label: string; required?: boolean; default?: boolean }
  | {
      kind: 'file';
      key: string;
      label: string;
      required?: boolean;
      accept: FileDescriptor['accept'];
      /** True when the descriptor declares `array` — runner should loop. */
      multi: boolean;
      arrayMax?: number;
    }
  | {
      kind: 'object';
      key: string;
      label: string;
      required?: boolean;
      fields: readonly WizardStep[];
      arrayMax?: number;
    };

export function generateWizardStepsFromCatalog(catalog: Catalog): readonly WizardStep[] {
  const steps: WizardStep[] = [];
  for (const surface of catalog.all()) {
    const step = stepForSurface(surface);
    if (step !== undefined) steps.push(step);
  }
  return steps;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Top-level surfaces                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

function stepForSurface(surface: ParamSurface): WizardStep | undefined {
  const required = surface.requiredInModels.length > 0;
  return descriptorToStep(surface.key, labelFromSurface(surface), surface.descriptor, required);
}

function labelFromSurface(surface: ParamSurface): string {
  for (const label of surface.perModelLabels.values()) {
    if (label && label.trim().length > 0) return label;
  }
  return surface.key;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Descriptor → step (used for both top-level and subfields)             */
/* ─────────────────────────────────────────────────────────────────────── */

function descriptorToStep(
  key: string,
  label: string,
  descriptor: ParamDescriptor,
  required: boolean,
): WizardStep | undefined {
  switch (descriptor.kind) {
    case 'text':
      return withRequired(
        { kind: 'text', key, label, minLength: descriptor.minLength, maxLength: descriptor.maxLength },
        required,
      );
    case 'enum':
      return withRequired(makeSelectStep(key, label, descriptor), required);
    case 'range':
      return withRequired(
        { kind: 'number', key, label, min: descriptor.min, max: descriptor.max, default: descriptor.default },
        required,
      );
    case 'boolean':
      return withRequired({ kind: 'confirm', key, label, default: descriptor.default }, required);
    case 'object':
      return withRequired(makeObjectStep(key, label, descriptor), required);
    case 'file':
      return withRequired(makeFileStep(key, label, descriptor), required);
  }
}

function makeFileStep(key: string, label: string, descriptor: FileDescriptor): WizardStep {
  const step: WizardStep = {
    kind: 'file',
    key,
    label,
    accept: descriptor.accept,
    multi: descriptor.array !== undefined,
  };
  if (descriptor.array?.max !== undefined) {
    return { ...step, arrayMax: descriptor.array.max };
  }
  return step;
}

function withRequired<S extends WizardStep>(step: S, required: boolean): S {
  return required ? { ...step, required: true } : step;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  enum → select                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

function makeSelectStep(
  key: string,
  label: string,
  descriptor: EnumDescriptor<string> | EnumDescriptor<number>,
): WizardStep {
  if (descriptor.valueType === 'number') {
    const d = descriptor as EnumDescriptor<number>;
    return {
      kind: 'select',
      key,
      label,
      choices: d.options.map((o) => ({ id: o.id, label: o.label ?? String(o.id) })),
      default: d.default,
    };
  }
  const d = descriptor as EnumDescriptor<string>;
  return {
    kind: 'select',
    key,
    label,
    choices: d.options.map((o) => ({ id: o.id, label: o.label ?? o.id })),
    default: d.default,
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  object → recursive sub-steps                                          */
/* ─────────────────────────────────────────────────────────────────────── */

function makeObjectStep(key: string, label: string, descriptor: ObjectDescriptor): WizardStep {
  // Build subfield steps, then order them required-first / optional-last
  // so the wizard asks for the meaningful fields before the filler ones.
  // For e.g. `multiPrompt { index (default 0), prompt, duration }` this
  // surfaces `prompt` then `duration` then `index` — matching how a user
  // thinks about a shot.
  const fields: WizardStep[] = [];
  for (const [subKey, subDesc] of Object.entries(descriptor.fields)) {
    const subRequired = !hasDefault(subDesc);
    const subLabel = humanizeKey(subKey);
    const subStep = descriptorToStep(subKey, subLabel, subDesc, subRequired);
    if (subStep !== undefined) fields.push(subStep);
  }
  fields.sort((a, b) => {
    const ar = a.required === true ? 0 : 1;
    const br = b.required === true ? 0 : 1;
    return ar - br;
  });
  const step: WizardStep = { kind: 'object', key, label, fields };
  if (descriptor.array?.max !== undefined) {
    return { ...step, arrayMax: descriptor.array.max };
  }
  return step;
}

/**
 * `image_url` → `"Image Url"`, `prompt` → `"Prompt"`,
 * `keep_original_sound` → `"Keep Original Sound"`. Used for subfield
 * labels because SDK descriptors only declare a label at the top
 * level, not per subfield.
 */
function humanizeKey(key: string): string {
  return key
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .map((w) => (w.length === 0 ? '' : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
    .trim();
}

/**
 * Subfield "required" = "this subfield has no default" — the same rule
 * the interpret-half (interpret/objects.ts) uses to decide whether to
 * throw when the value is missing at a populated index.
 */
function hasDefault(desc: ParamDescriptor): boolean {
  switch (desc.kind) {
    case 'enum':
    case 'boolean':
      return desc.default !== undefined;
    case 'range':
      return desc.default !== undefined;
    default:
      return false; // text, file, object have no inherent default
  }
}

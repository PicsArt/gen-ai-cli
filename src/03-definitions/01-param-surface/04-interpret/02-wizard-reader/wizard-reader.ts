/**
 * Wizard Reader — answers → ctx.
 *
 * The interpret-half twin of `03-describe/02-wizard-schema/`. Where
 * flag-reader consumes oclif-parsed flag values, this consumes the
 * answers object a wizard runner produces. Both produce the same
 * `Partial<GenerationContext>` shape the SDK's buildPayload reads.
 *
 *   wizard answers       →   ┌────────────────────┐   →   Partial<
 *   { prompt: 'sunset',       │  wizard-reader     │       GenerationContext>
 *     duration: 10,           │  walks catalog,    │       { prompt: 'sunset',
 *     generateAudio: true,    │  per-kind dispatch │         duration: 10,
 *     multiPrompt: [          │                    │         generateAudio: true,
 *       { prompt: 'wide',     └────────────────────┘         multiPrompt: [...] }
 *         duration: '5' } ] }
 *
 * Per-kind behavior:
 *   - file        skipped (resolver's file pipeline owns these)
 *   - object      expects an array of subfield-keyed records; each
 *                 value is coerced through primitives/coercion;
 *                 missing subfields are backfilled from their descriptor
 *                 default, or UsageError if there is none
 *   - everything  delegated to primitives/coercion (coerceToDescriptor)
 *
 * Why the answers shape differs from the flag-reader's input:
 *
 *   flag-reader  : flat oclif flags object — subfield arrays paired by
 *                  position (`--shot-prompt`/`--shot-duration`)
 *   wizard-reader: structured items — the runner did the per-item loop
 *                  while prompting, so each item already carries all
 *                  the user-provided subfields together
 *
 * Both produce the same items array in ctx; the assembly happens in
 * different places.
 *
 * Answer keys map to `surface.key` (camelCase) — the same key
 * wizard-schema emitted on each WizardStep. Keys that don't match a
 * surface in the catalog are silently ignored (the runner may attach
 * its own metadata).
 */
import type { GenerationContext, ObjectDescriptor, ParamDescriptor } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { autoNumberIndexField, coerceToDescriptor } from '../../01-primitives/02-coercion/index.ts';
import type { Catalog, ParamSurface } from '../../02-catalog/index.ts';

export function collectContextFromAnswers(
  answers: Record<string, unknown>,
  catalog: Catalog,
): Partial<GenerationContext> {
  const ctx: Record<string, unknown> = {};
  for (const surface of catalog.all()) {
    const value = readOne(answers, surface);
    if (value !== undefined) ctx[surface.key] = value;
  }
  return ctx as Partial<GenerationContext>;
}

function readOne(answers: Record<string, unknown>, surface: ParamSurface): unknown {
  const kind = surface.descriptor.kind;
  if (kind === 'file') return undefined;

  const raw = answers[surface.key];
  if (raw === undefined) return undefined;

  if (kind === 'object') return readObjectArray(raw, surface);
  return coerceToDescriptor(raw, surface.descriptor);
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Object descriptors                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

function readObjectArray(raw: unknown, surface: ParamSurface): unknown {
  const desc = surface.descriptor as ObjectDescriptor;

  // Non-array object (SDK convention: `array` undefined = ONE bare object,
  // e.g. loraWeights). Accept a single record and pass it through as `{...}`.
  if (desc.array === undefined) {
    if (Array.isArray(raw)) {
      throw new UsageError(`Expected a single object for '${surface.key}', got an array.`);
    }
    return readItem(raw, desc, surface.key, 0);
  }

  if (!Array.isArray(raw)) {
    throw new UsageError(`Expected an array for '${surface.key}', got ${describe(raw)}.`);
  }
  if (raw.length === 0) return undefined;

  enforceMax(surface.key, desc.array?.max, raw.length);

  // Whether the ANSWERS carried explicit index values — checked on the raw
  // items, before default-backfill makes provided and defaulted look alike.
  const explicitIndex = raw.some(
    (item) => item !== null && typeof item === 'object' && (item as Record<string, unknown>).index !== undefined,
  );

  const items = raw.map((item, index) => readItem(item, desc, surface.key, index));
  // Same positional `index` backfill as the flag reader — keeps wizard and
  // scripted paths producing identical payloads. Numbering starts at the
  // descriptor's declared minimum (Kling multiPrompt: 0..5 for 6 shots);
  // explicit answers, even zeros, are the caller's intent and stay verbatim.
  if ('index' in desc.fields && !explicitIndex) {
    const idxDesc = desc.fields.index;
    const start = idxDesc.kind === 'range' ? idxDesc.min : 1;
    return autoNumberIndexField(items, start);
  }
  return items;
}

function readItem(item: unknown, desc: ObjectDescriptor, parentKey: string, index: number): Record<string, unknown> {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new UsageError(`Expected an object at ${parentKey}[${index}], got ${describe(item)}.`);
  }
  const src = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [subKey, subDesc] of Object.entries(desc.fields)) {
    out[subKey] = resolveSubfield(src[subKey], subDesc, parentKey, subKey, index);
  }
  return out;
}

function resolveSubfield(
  provided: unknown,
  desc: ParamDescriptor,
  parentKey: string,
  subKey: string,
  index: number,
): unknown {
  if (provided !== undefined) return coerceToDescriptor(provided, desc);

  const def = descriptorDefault(desc);
  if (def !== undefined) return def;

  throw new UsageError(`${parentKey}[${index}].${subKey}: missing required value (subfield has no default)`);
}

function descriptorDefault(desc: ParamDescriptor): unknown {
  switch (desc.kind) {
    case 'enum':
    case 'boolean':
    case 'catalog':
      return desc.default;
    case 'range':
      return desc.default;
    default:
      return undefined;
  }
}

function enforceMax(key: string, max: number | undefined, count: number): void {
  if (max !== undefined && count > max) {
    throw new UsageError(`${key} accepts at most ${max} items, got ${count}.`);
  }
}

function describe(raw: unknown): string {
  if (raw === null) return 'null';
  if (Array.isArray(raw)) return 'array';
  return typeof raw;
}

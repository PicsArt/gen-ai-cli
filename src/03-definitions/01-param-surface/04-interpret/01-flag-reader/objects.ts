/**
 * Interpret-half of object-descriptor handling. Reads the flags the
 * describe-half (03-describe/01-flag-schema/objects.ts) emitted, then
 * assembles them into the shape the SDK consumes.
 *
 * Array objects (`descriptor.array` set):
 *   Single-field: one repeatable flag → one item per value.
 *   Multi-field: per-subfield repeatable flags paired by position.
 * Non-array objects (`descriptor.array` undefined — SDK convention for
 * "this param is ONE bare object", e.g. loraWeights):
 *   Single-field: one scalar flag → one object.
 *   Multi-field: per-subfield scalar flags → one object.
 *
 * Behavior:
 *   - each value runs through `coerceToDescriptor` (primitives/coercion)
 *   - respects `array.max`
 *   - backfills missing optional subfields from descriptor defaults
 *   - throws `UsageError` when a no-default subfield is missing at an
 *     index that other subfields populate
 *   - an `index` subfield is auto-numbered consecutively from its declared
 *     minimum UNLESS the caller passed the `--*-index` flag explicitly
 */
import type { ObjectDescriptor, ParamDescriptor } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { autoNumberIndexField, coerceToDescriptor, subfieldFlagName } from '../../01-primitives/02-coercion/index.ts';
import type { ParamSurface } from '../../02-catalog/index.ts';

export function interpretObjectArray(flags: Record<string, unknown>, surface: ParamSurface): unknown {
  const desc = assertObject(surface);
  const fieldKeys = Object.keys(desc.fields);

  if (desc.array === undefined) {
    return interpretSingleObject(flags, surface, desc, fieldKeys);
  }
  if (fieldKeys.length === 1) {
    return interpretSingleField(flags, surface, desc, fieldKeys[0]);
  }
  return interpretMultiField(flags, surface, desc, fieldKeys);
}

/**
 * Non-array object: `array` undefined means the SDK expects one bare object
 * (`{...}`, never `[{...}]`). Flags arrive as scalars — the describe-half
 * emits them without `multiple`.
 */
function interpretSingleObject(
  flags: Record<string, unknown>,
  surface: ParamSurface,
  desc: ObjectDescriptor,
  fieldKeys: readonly string[],
): Record<string, unknown> | undefined {
  // Single-field non-array objects live under the parent flag itself,
  // mirroring the describe-half's naming for the array case.
  const readFlag = (subKey: string): unknown =>
    fieldKeys.length === 1 ? flags[surface.flag] : flags[subfieldFlagName(surface.flag, subKey)];

  const anyProvided = fieldKeys.some((subKey) => readFlag(subKey) !== undefined);
  if (!anyProvided) return undefined;

  const item: Record<string, unknown> = {};
  for (const subKey of fieldKeys) {
    const subDesc = desc.fields[subKey];
    const provided = readFlag(subKey);
    item[subKey] = resolveSubfieldValue(surface.flag, subKey, subDesc, provided, 0);
  }
  return item;
}

function interpretSingleField(
  flags: Record<string, unknown>,
  surface: ParamSurface,
  desc: ObjectDescriptor,
  subKey: string,
): unknown[] | undefined {
  const raw = flags[surface.flag];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  enforceMax(`--${surface.flag}`, desc.array?.max, raw.length);

  const subDesc = desc.fields[subKey];
  return raw.map((v) => ({ [subKey]: coerceToDescriptor(v, subDesc) }));
}

function interpretMultiField(
  flags: Record<string, unknown>,
  surface: ParamSurface,
  desc: ObjectDescriptor,
  fieldKeys: readonly string[],
): unknown[] | undefined {
  // Gather each subfield's array under its prefixed flag name.
  const subArrays = new Map<string, readonly unknown[]>();
  for (const subKey of fieldKeys) {
    const raw = flags[subfieldFlagName(surface.flag, subKey)];
    if (Array.isArray(raw) && raw.length > 0) subArrays.set(subKey, raw);
  }

  if (subArrays.size === 0) return undefined;

  // Item count = MAX length across all provided subfield arrays.
  const itemCount = Math.max(...[...subArrays.values()].map((a) => a.length));
  enforceMax(`--${surface.flag}-*`, desc.array?.max, itemCount);

  const items: Array<Record<string, unknown>> = [];
  for (let i = 0; i < itemCount; i++) {
    const item: Record<string, unknown> = {};
    for (const subKey of fieldKeys) {
      const subDesc = desc.fields[subKey];
      const arr = subArrays.get(subKey);
      const provided = arr && i < arr.length ? arr[i] : undefined;
      item[subKey] = resolveSubfieldValue(surface.flag, subKey, subDesc, provided, i);
    }
    items.push(item);
  }

  // Backfill positional indices when the caller didn't pass the `--*-index`
  // flag at all. Numbering starts at the descriptor's declared minimum so it
  // can never overflow the range (Kling multiPrompt: 0..5 for 6 items). An
  // explicit `--*-index` — even all zeros — is the caller's intent: keep it.
  if ('index' in desc.fields && !subArrays.has('index')) {
    const idxDesc = desc.fields.index;
    const start = idxDesc.kind === 'range' ? idxDesc.min : 1;
    return autoNumberIndexField(items, start);
  }
  return items;
}

function resolveSubfieldValue(
  parentFlag: string,
  subKey: string,
  desc: ParamDescriptor,
  provided: unknown,
  index: number,
): unknown {
  if (provided !== undefined) return coerceToDescriptor(provided, desc);

  const def = descriptorDefault(desc);
  if (def !== undefined) return def;

  throw new UsageError(
    `--${subfieldFlagName(parentFlag, subKey)}[${index}]: missing required value (subfield has no default)`,
  );
}

function descriptorDefault(desc: ParamDescriptor): unknown {
  switch (desc.kind) {
    case 'enum':
    case 'boolean':
    case 'catalog':
      return desc.default;
    case 'range':
      return desc.default; // may be undefined for fields like seed
    default:
      return undefined; // text, file, object have no inherent default
  }
}

function assertObject(surface: ParamSurface): ObjectDescriptor {
  if (surface.descriptor.kind !== 'object') {
    throw new Error(
      `interpretObjectArray: expected object descriptor, got '${surface.descriptor.kind}' for key '${surface.key}'`,
    );
  }
  return surface.descriptor;
}

/** `flagLabel` arrives fully rendered: `--voice` (single-field) or `--shot-*` (multi-field family). */
function enforceMax(flagLabel: string, max: number | undefined, count: number): void {
  if (max !== undefined && count > max) {
    throw new UsageError(`${flagLabel} accepts at most ${max} items, got ${count}.`);
  }
}

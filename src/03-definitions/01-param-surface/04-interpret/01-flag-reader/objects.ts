/**
 * Interpret-half of object-descriptor handling. Reads the flags the
 * describe-half (03-describe/01-flag-schema/objects.ts) emitted, then
 * zips them by position into an array of items the SDK consumes.
 *
 * Single-field objects: one repeatable flag → one item per value.
 * Multi-field objects: per-subfield repeatable flags paired by position.
 *
 * Behavior:
 *   - each value runs through `coerceToDescriptor` (primitives/coercion)
 *   - respects `array.max`
 *   - backfills missing optional subfields from descriptor defaults
 *   - throws `UsageError` when a no-default subfield is missing at an
 *     index that other subfields populate
 */
import type { ObjectDescriptor, ParamDescriptor } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { autoNumberIndexField, coerceToDescriptor, subfieldFlagName } from '../../01-primitives/02-coercion/index.ts';
import type { ParamSurface } from '../../02-catalog/index.ts';

export function interpretObjectArray(flags: Record<string, unknown>, surface: ParamSurface): unknown[] | undefined {
  const desc = assertObject(surface);
  const fieldKeys = Object.keys(desc.fields);

  if (fieldKeys.length === 1) {
    return interpretSingleField(flags, surface, desc, fieldKeys[0]);
  }
  return interpretMultiField(flags, surface, desc, fieldKeys);
}

function interpretSingleField(
  flags: Record<string, unknown>,
  surface: ParamSurface,
  desc: ObjectDescriptor,
  subKey: string,
): unknown[] | undefined {
  const raw = flags[surface.flag];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  enforceMax(surface.flag, desc.array?.max, raw.length);

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
  enforceMax(surface.flag, desc.array?.max, itemCount);

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
  // Backfill a positional `index` (1..N) when the caller relied on the
  // descriptor's default-0. Vendors like Kling require 1-based consecutive
  // indices; without this, the API rejects with a cryptic 400.
  return 'index' in desc.fields ? autoNumberIndexField(items) : items;
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

function enforceMax(flag: string, max: number | undefined, count: number): void {
  if (max !== undefined && count > max) {
    throw new UsageError(`--${flag}-* accepts at most ${max} items, got ${count}.`);
  }
}

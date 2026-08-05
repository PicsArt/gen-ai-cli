/**
 * Coercion — pure value conversion + camelCase ↔ kebab-case helpers.
 *
 * No SDK imports at runtime (only type-only imports), no oclif imports,
 * no I/O. The lowest-level primitive in the param-surface block — used
 * by the describe and interpret halves alike.
 *
 * The kind table:
 *   enum<string>  string in `options`                        → string
 *   enum<number>  numeric coercion + `options` membership    → number
 *   boolean       boolean or 'true'/'false' string           → boolean
 *   range         numeric coercion + [min,max] bounds        → number
 *   text          string + minLength/maxLength               → string
 *   file          → throws Error (handled by file pipeline)
 *   object        → throws Error (handled by interpret/objects)
 *
 * Validation failures throw `UsageError` so the CLI surfaces them as
 * user-facing errors with the exact problem cited.
 */
import type { EnumDescriptor, EnumOption, ParamDescriptor, RangeDescriptor, TextDescriptor } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Name conversion                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g;

export function camelToKebab(s: string): string {
  if (s === '') throw new Error('camelToKebab: empty string');
  return s.replace(CAMEL_BOUNDARY, '$1-$2').toLowerCase();
}

const KEBAB_SEGMENT = /-([a-z0-9])/g;

export function kebabToCamel(s: string): string {
  if (s === '') throw new Error('kebabToCamel: empty string');
  return s.replace(KEBAB_SEGMENT, (_, c: string) => c.toUpperCase());
}

/**
 * Naming convention for object-descriptor subfield flags. The describe
 * side emits flag names with this rule; the interpret side reads them
 * back the same way. Single source of truth so the two halves can never
 * drift apart.
 *
 * Subfield keys come from the SDK descriptor in whatever shape the
 * vendor chose — `image_url` (snake_case, matching JSON-API field
 * names) or `imageUrl` (camelCase, matching JS conventions). We
 * normalize both into uniform kebab-case so the resulting flag is
 * `--omni-image-list-image-url`, never `--omni-image-list-image_url`.
 */
export function subfieldFlagName(parentFlag: string, subKey: string): string {
  return `${parentFlag}-${snakeOrCamelToKebab(subKey)}`;
}

function snakeOrCamelToKebab(s: string): string {
  if (s === '') throw new Error('snakeOrCamelToKebab: empty string');
  return s.replace(/_+/g, '-').replace(CAMEL_BOUNDARY, '$1-$2').toLowerCase();
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  coerceToDescriptor — kind table dispatch                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

export function coerceToDescriptor(raw: unknown, descriptor: ParamDescriptor): unknown {
  // null and undefined both mean "flag not provided" (batch manifests can
  // carry explicit nulls). Coercing null onward would invent values, e.g.
  // Number(null) === 0 for range descriptors.
  if (raw === undefined || raw === null) return undefined;

  switch (descriptor.kind) {
    case 'enum':
      return descriptor.valueType === 'number'
        ? coerceEnumNumber(raw, descriptor as EnumDescriptor<number>)
        : coerceEnumString(raw, descriptor as EnumDescriptor<string>);
    case 'boolean':
      return coerceBoolean(raw);
    case 'range':
      return coerceRange(raw, descriptor);
    case 'text':
      return coerceText(raw, descriptor);
    case 'file':
      throw new Error('coerceToDescriptor: file inputs are handled by the file pipeline, not here');
    case 'object':
      throw new Error('coerceToDescriptor: object inputs are handled by interpret/objects, not here');
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Per-kind coercers                                                         */
/* ─────────────────────────────────────────────────────────────────────────── */

function coerceEnumString(raw: unknown, descriptor: EnumDescriptor<string>): string {
  if (typeof raw !== 'string') {
    throw new UsageError(`Expected a string, got ${describeValue(raw)}. Allowed: ${listOptions(descriptor.options)}.`);
  }
  if (!descriptor.options.some((o) => o.id === raw)) {
    throw new UsageError(`Invalid value "${raw}". Allowed: ${listOptions(descriptor.options)}.`);
  }
  return raw;
}

function coerceEnumNumber(raw: unknown, descriptor: EnumDescriptor<number>): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(num)) {
    throw new UsageError(`Expected a number, got "${String(raw)}". Allowed: ${listOptions(descriptor.options)}.`);
  }
  if (!descriptor.options.some((o) => o.id === num)) {
    throw new UsageError(`Invalid value ${num}. Allowed: ${listOptions(descriptor.options)}.`);
  }
  return num;
}

function coerceBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new UsageError(`Expected a boolean, got ${describeValue(raw)}.`);
}

function coerceRange(raw: unknown, descriptor: RangeDescriptor): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(num)) {
    throw new UsageError(`Expected a number in [${descriptor.min}, ${descriptor.max}], got "${String(raw)}".`);
  }
  if (num < descriptor.min || num > descriptor.max) {
    throw new UsageError(`Value ${num} is out of range [${descriptor.min}, ${descriptor.max}].`);
  }
  return num;
}

function coerceText(raw: unknown, descriptor: TextDescriptor): string {
  if (typeof raw !== 'string') {
    throw new UsageError(`Expected a string, got ${describeValue(raw)}.`);
  }
  if (descriptor.minLength !== undefined && raw.length < descriptor.minLength) {
    throw new UsageError(`Value is ${raw.length} characters; minimum is ${descriptor.minLength}.`);
  }
  if (descriptor.maxLength !== undefined && raw.length > descriptor.maxLength) {
    throw new UsageError(`Value is ${raw.length} characters; maximum is ${descriptor.maxLength}.`);
  }
  return raw;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Array post-processing                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * When an object-array descriptor declares a subfield literally named
 * `index`, populate it positionally (1, 2, 3, …) unless the caller supplied
 * a non-zero value. Several vendors (Kling V3 multi-shot, omni-image-list)
 * require 1-based consecutive indices but the SDK descriptor defaults to 0,
 * so without this step every item ships with `index: 0` and the API rejects.
 *
 * Pure — returns a new array. Caller-supplied non-zero indices are preserved
 * verbatim; only the all-zero default gets rewritten.
 */
export function autoNumberIndexField(items: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  if (items.length === 0) return [];
  const callerSupplied = items.some((item) => {
    const v = item.index;
    return typeof v === 'number' && v > 0;
  });
  if (callerSupplied) return items.map((item) => ({ ...item }));
  return items.map((item, i) => ({ ...item, index: i + 1 }));
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Internal helpers                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

function listOptions<T extends string | number>(options: ReadonlyArray<EnumOption<T>>): string {
  return options.map((o) => String(o.id)).join(', ');
}

function describeValue(raw: unknown): string {
  if (raw === null) return 'null';
  if (raw === undefined) return 'undefined';
  return `${typeof raw} "${String(raw)}"`;
}

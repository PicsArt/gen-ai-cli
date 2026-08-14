/**
 * Flag Schema — the describe-half for oclif flags.
 *
 * Turns a Catalog into a set of oclif Flag definitions that operation
 * commands spread into their `static flags = {...}` block. The
 * symmetric inverse lives in `04-interpret/01-flag-reader/`.
 *
 * Kind table:
 *   enum<string>  → Flags.string({ options: [...] })
 *   enum<number>  → Flags.string({ options: stringified[] })  ← flag-reader coerces
 *   boolean       → Flags.boolean({ allowNo: true })
 *   range         → Flags.string()                            ← flag-reader coerces
 *   text          → Flags.string()
 *   catalog       → Flags.string()  (free-string id; live catalog validates)
 *   file          → skipped (file pipeline owns file inputs)
 *   object        → delegated to `./objects.ts` (per-subfield flags)
 *
 * Aliases applied from ParamSurface (resolved by the catalog):
 *   - `char`        → single-letter short
 *   - `flagAliases` → extra long-form names
 *
 * Description is taken from the first non-empty per-model label, falling
 * back to the camelCase key if no model supplied a label.
 */
import { Flags } from '@oclif/core';
import type { EnumDescriptor, FileDescriptor } from '@picsart/ai-sdk';
import type { Catalog, ParamSurface } from '../../02-catalog/index.ts';
import { aliasOpts, describeFlag, distinctLabelCount } from './description.ts';
import { describeObjectFlags } from './objects.ts';

/** Spreadable into an oclif command's `static flags = {...}`. */
export type FlagSet = Record<string, unknown>;

export function generateFlagsFromCatalog(catalog: Catalog): FlagSet {
  const out: FlagSet = {};
  for (const surface of catalog.all()) {
    Object.assign(out, flagsFor(surface));
  }
  return out;
}

function flagsFor(surface: ParamSurface): FlagSet {
  const desc = surface.descriptor;
  switch (desc.kind) {
    case 'enum':
      return { [surface.flag]: makeEnumFlag(surface, desc) };
    case 'boolean':
      return { [surface.flag]: makeBooleanFlag(surface) };
    case 'range':
      return { [surface.flag]: makeRangeOrTextFlag(surface) };
    case 'text':
      return { [surface.flag]: makeRangeOrTextFlag(surface) };
    case 'catalog':
      // Free-string id served by a platform catalog task (voiceId, videoId).
      // Membership is validated by the live catalog, not the CLI, so this is
      // a plain string flag.
      return { [surface.flag]: makeRangeOrTextFlag(surface) };
    case 'file':
      // Emit a path flag so oclif accepts `--<flag> <path>`. The resolver
      // is what actually uploads the file and substitutes the URL into
      // ctx — the flag-reader still skips file kinds, so this stays a
      // declaration-only path through Param Surface.
      return { [surface.flag]: makeFileFlag(surface, desc) };
    case 'object':
      // Object descriptors expand into per-subfield flags. See ./objects.ts.
      return describeObjectFlags(surface);
    default:
      return unreachableKind(desc);
  }
}

/**
 * Compile-time exhaustiveness guard. A new SDK descriptor kind fails the
 * build here instead of silently emitting no flag — the failure mode that
 * hid `catalog` params (no `--voice` flag) when SDK 5 introduced the kind.
 */
function unreachableKind(desc: never): never {
  throw new Error(`flagsFor: unhandled descriptor kind '${(desc as { kind: string }).kind}'`);
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Per-kind factories                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

function makeEnumFlag(surface: ParamSurface, desc: EnumDescriptor<string> | EnumDescriptor<number>): unknown {
  return Flags.string({
    description: describeFlag(surface),
    options: desc.options.map((o) => String(o.id)),
    ...aliasOpts(surface),
  });
}

function makeBooleanFlag(surface: ParamSurface): unknown {
  return Flags.boolean({
    description: describeFlag(surface),
    allowNo: true,
    ...aliasOpts(surface),
  });
}

function makeRangeOrTextFlag(surface: ParamSurface): unknown {
  return Flags.string({
    description: describeFlag(surface),
    ...aliasOpts(surface),
  });
}

function makeFileFlag(surface: ParamSurface, desc: FileDescriptor): unknown {
  const description = describeFileFlag(surface, desc);
  const alias = aliasOpts(surface);
  return desc.array !== undefined
    ? Flags.string({ description, multiple: true, ...alias })
    : Flags.string({ description, ...alias });
}

function describeFileFlag(surface: ParamSurface, desc: FileDescriptor): string {
  // No labels at all → the hint alone. One agreed label, or a neutral
  // flag-derived name when models disagree → "<label> — <hint>".
  const hint = fileHint(surface, desc);
  return distinctLabelCount(surface) === 0 ? hint : `${describeFlag(surface)} — ${hint}`;
}

/**
 * Path hint for a file flag. The merged descriptor's `array.max` is whatever
 * the first-walked model declared (the catalog merges file kinds first-wins),
 * so it is only trustworthy when a single model owns the flag. When the flag
 * is shared by several models that can disagree on the cap — e.g. `imageUrls`
 * ranges from 1 to 14 across models — asserting a specific "(max N)" would
 * mislead, so present it as repeatable instead.
 */
function fileHint(surface: ParamSurface, desc: FileDescriptor): string {
  if (!desc.array) return `path to ${desc.accept} file`;
  const trustMax = surface.models.length === 1 && desc.array.max !== undefined;
  return trustMax
    ? `path(s) to ${desc.accept} file (max ${desc.array.max})`
    : `path(s) to ${desc.accept} files (repeatable)`;
}

// Description text and alias options live in ./description.ts, shared
// with the object-descriptor expansion (./objects.ts).

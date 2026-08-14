/**
 * Shared description / alias helpers for the flag-schema sub-part.
 * Used by both the scalar factories (`flag-schema.ts`) and the
 * object-descriptor expansion (`objects.ts`) so every emitted flag —
 * including per-subfield object flags — carries help text and aliases.
 */
import { humanizeKey } from '../../01-primitives/02-coercion/index.ts';
import type { ParamSurface } from '../../02-catalog/index.ts';

export function describeFlag(surface: ParamSurface): string {
  // Exactly one agreed label → authoritative. Otherwise (no labels, or
  // models DISAGREE — e.g. `imageUrls` is "Reference Images" for Veo but
  // "Person Photo (upper body)" for Kling) collapse to a neutral name
  // derived from the user-facing flag ("--image" → "Image") rather than
  // letting whichever model was walked first dictate the help.
  return explicitLabel(surface) ?? humanizeKey(surface.flag);
}

/**
 * The single label every declaring model agrees on, or undefined when no
 * model supplied one / models disagree.
 */
export function explicitLabel(surface: ParamSurface): string | undefined {
  const distinct = distinctLabels(surface);
  return distinct.size === 1 ? [...distinct][0] : undefined;
}

/** How many distinct, non-empty labels the declaring models supplied. */
export function distinctLabelCount(surface: ParamSurface): number {
  return distinctLabels(surface).size;
}

function distinctLabels(surface: ParamSurface): ReadonlySet<string> {
  const distinct = new Set<string>();
  for (const label of surface.perModelLabels.values()) {
    const trimmed = label?.trim();
    if (trimmed) distinct.add(trimmed);
  }
  return distinct;
}

/**
 * Common alias options shared by every flag factory. oclif types `char`
 * narrowly as a single alphabet character literal; conditional spread
 * + cast keeps the call sites type-clean without spreading `undefined`.
 */
export function aliasOpts(surface: ParamSurface): {
  char?: 'a';
  aliases?: string[];
} {
  const opts: { char?: 'a'; aliases?: string[] } = {};
  if (surface.char !== undefined) opts.char = surface.char as 'a';
  if (surface.flagAliases.length > 0) opts.aliases = [...surface.flagAliases];
  return opts;
}

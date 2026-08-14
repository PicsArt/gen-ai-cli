/**
 * Describe-half of object-descriptor handling. Walks an object descriptor
 * and emits the oclif Flag set the user invokes; the interpret-half
 * (04-interpret/01-flag-reader/objects.ts) reads those same flags back
 * into items. Naming convention shared via `subfieldFlagName`.
 *
 * Two shapes:
 *
 *   SINGLE-FIELD object (e.g. voiceList: [{voice_id}])
 *     One repeatable flag named after the parent. The value lands in the
 *     single subfield.
 *
 *       --voice vx_1 --voice vx_2
 *         → [{ voice_id: 'vx_1' }, { voice_id: 'vx_2' }]
 *
 *   MULTI-FIELD object (e.g. multiPrompt: [{index, prompt, duration}])
 *     One repeatable flag per subfield, prefixed by parent flag. The
 *     interpret-half pairs them by position to assemble items.
 *
 *       --shot-prompt "wide" --shot-prompt "close-up"
 *       --shot-duration 5    --shot-duration 7
 */
import { Flags } from '@oclif/core';
import type { ObjectDescriptor } from '@picsart/ai-sdk';
import { humanizeKey, subfieldFlagName } from '../../01-primitives/02-coercion/index.ts';
import type { ParamSurface } from '../../02-catalog/index.ts';
import { aliasOpts, describeFlag } from './description.ts';

// `unknown` (same as flag-schema's FlagSet): repeatable subfield flags are
// OptionFlag<string[]>, non-array ones OptionFlag<string> — oclif's overload
// types don't share a useful common supertype.
export type ObjectFlagSet = Record<string, unknown>;

export function describeObjectFlags(surface: ParamSurface): ObjectFlagSet {
  const desc = assertObject(surface);
  const fieldKeys = Object.keys(desc.fields);

  if (fieldKeys.length === 0) {
    throw new Error(`describeObjectFlags: object descriptor '${surface.key}' has no fields`);
  }

  const label = describeFlag(surface);

  // SDK convention: `array` undefined means the param is ONE bare object
  // (e.g. loraWeights), so its flags take a single value — repeatable flags
  // would make the interpret-half ship `[{...}]` where the API wants `{...}`.
  const repeatable = desc.array !== undefined;

  if (fieldKeys.length === 1) {
    return {
      [surface.flag]: repeatable
        ? Flags.string({ description: label, multiple: true, ...aliasOpts(surface) })
        : Flags.string({ description: label, ...aliasOpts(surface) }),
    };
  }

  // Multi-field: one flag per subfield. char/aliases stay off — they name
  // the parent, and there is no single parent flag to attach them to.
  const out: ObjectFlagSet = {};
  for (const subKey of fieldKeys) {
    const description = `${label} — ${humanizeKey(subKey)}`;
    out[subfieldFlagName(surface.flag, subKey)] = repeatable
      ? Flags.string({ description, multiple: true })
      : Flags.string({ description });
  }
  return out;
}

function assertObject(surface: ParamSurface): ObjectDescriptor {
  if (surface.descriptor.kind !== 'object') {
    throw new Error(
      `describeObjectFlags: expected object descriptor, got '${surface.descriptor.kind}' for key '${surface.key}'`,
    );
  }
  return surface.descriptor;
}

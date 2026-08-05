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
import { subfieldFlagName } from '../../01-primitives/02-coercion/index.ts';
import type { ParamSurface } from '../../02-catalog/index.ts';

export type ObjectFlagSet = Record<string, ReturnType<typeof Flags.string>>;

export function describeObjectFlags(surface: ParamSurface): ObjectFlagSet {
  const desc = assertObject(surface);
  const fieldKeys = Object.keys(desc.fields);

  if (fieldKeys.length === 0) {
    throw new Error(`describeObjectFlags: object descriptor '${surface.key}' has no fields`);
  }

  if (fieldKeys.length === 1) {
    return { [surface.flag]: Flags.string({ multiple: true }) };
  }

  const out: ObjectFlagSet = {};
  for (const subKey of fieldKeys) {
    out[subfieldFlagName(surface.flag, subKey)] = Flags.string({ multiple: true });
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

/**
 * SDK-gap flags — fields the SDK's `buildPayload` reads from ctx but no
 * model's `paramConfig` declares, so Param Surface can never derive a flag
 * for them. Today all four are Kling-specific. The resolver bridge
 * (`04-pipeline/02-resolve/types.ts` SDK_GAP_FLAGS) copies the parsed flag
 * values into the generation context under their camelCase keys.
 *
 * Kept in lock-step with `EXPECTED_SDK_GAPS` (param-surface aliases):
 * when the SDK adds a real descriptor, the catalog derives the flag, the
 * drift gate fails, and the entry here must be deleted — otherwise the
 * composed set would carry a duplicate.
 *
 * Aliases mirror ALIAS_MAP's documented shorthands so the flag surface is
 * identical to what the alias table advertises.
 */
import { Flags } from '@oclif/core';

/** Same shape as flag-set.ts's FlagSet — declared here to avoid an import cycle. */
type FlagSet = Record<string, unknown>;

/** All four gaps are Kling fields; ship them only where a Kling model can run. */
function anyKlingModel(allowedIds: ReadonlySet<string>): boolean {
  for (const id of allowedIds) {
    if (id.startsWith('kling')) return true;
  }
  return false;
}

export function sdkGapFlags(allowedIds: ReadonlySet<string>): FlagSet {
  if (!anyKlingModel(allowedIds)) return {};
  return {
    'external-task-id': Flags.string({
      description: 'Custom tracking id for the generation task (Kling)',
      aliases: ['task-id'],
    }),
    'sound-effect-prompt': Flags.string({
      description: 'Sound-effect prompt (Kling video-to-audio)',
      aliases: ['sfx-prompt'],
    }),
    'bgm-prompt': Flags.string({
      description: 'Background-music prompt (Kling video-to-audio)',
      aliases: ['bgm'],
    }),
    'asmr-mode': Flags.boolean({
      description: 'ASMR audio mode (Kling video-to-audio)',
      aliases: ['asmr'],
      allowNo: true,
    }),
  };
}

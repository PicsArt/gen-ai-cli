/**
 * Flag Reader — the interpret-half for oclif flags.
 *
 * The symmetric inverse of `03-describe/01-flag-schema/`. Given parsed
 * flag values (the object oclif emits after parsing argv) and the
 * Catalog, produces the generation context the SDK's buildPayload reads.
 *
 *   oclif parsed flags   →   ┌────────────────────┐   →   Partial<
 *   { 'aspect-ratio': '16:9'  │   flag-reader      │       GenerationContext>
 *     'cfg-scale': '7.5'      │   walks catalog,   │       { aspectRatio: '16:9',
 *     'shot-prompt': [...] }  │   per-kind dispatch│         cfgScale: 7.5,
 *                             └────────────────────┘         multiPrompt: [...] }
 *
 * Per-kind behavior:
 *   - file        skipped (resolver's file pipeline owns these)
 *   - object      delegated to `./objects.ts` (interpretObjectArray)
 *   - everything  delegated to `primitives/coercion` (coerceToDescriptor)
 *
 * oclif normalizes aliases / chars to the canonical flag name during
 * parsing, so this reader only reads under `surface.flag` — it does not
 * need to know about `--ar` or `-p`.
 *
 * Flags NOT in the catalog (e.g. universal --json) are silently ignored.
 * The downstream flow-filter block decides "is this flag valid for this
 * flow?" — not this one.
 */
import type { GenerationContext, ParamDescriptor } from '@picsart/ai-sdk';
import { coerceToDescriptor } from '../../01-primitives/02-coercion/index.ts';
import type { Catalog, ParamSurface } from '../../02-catalog/index.ts';
import { interpretObjectArray } from './objects.ts';

/**
 * @param modelId When the caller already knows which model will run, its own
 * (unmerged) descriptor takes precedence over the cross-model merge — the
 * merged surface keeps only the first-seen kind, so without this a model
 * whose kind diverges (e.g. flux-3-video's enum<string> duration vs the
 * majority enum<number>) gets its values coerced to the wrong type or
 * rejected outright.
 */
export function collectGenerationContext(
  flags: Record<string, unknown>,
  catalog: Catalog,
  modelId?: string,
): Partial<GenerationContext> {
  const ctx: Record<string, unknown> = {};
  for (const surface of catalog.all()) {
    const value = collectOne(flags, surface, modelId);
    if (value !== undefined) ctx[surface.key] = value;
  }
  return ctx as Partial<GenerationContext>;
}

function collectOne(flags: Record<string, unknown>, surface: ParamSurface, modelId?: string): unknown {
  // The selected model's own descriptor wins; models that don't declare the
  // param (and callers with no model in hand) fall back to the merged view.
  const descriptor: ParamDescriptor =
    (modelId !== undefined ? surface.descriptorsByModel.get(modelId) : undefined) ?? surface.descriptor;
  const kind = descriptor.kind;

  // File descriptors are owned by the resolver's file pipeline (uploads
  // local paths, etc.). The flag-reader must never write to ctx for them.
  if (kind === 'file') return undefined;

  // Object descriptors fan out across per-subfield flag names. See ./objects.ts.
  if (kind === 'object') return interpretObjectArray(flags, surface);

  // Scalar kinds: read the canonical flag name, coerce via primitives.
  return coerceToDescriptor(flags[surface.flag], descriptor);
}

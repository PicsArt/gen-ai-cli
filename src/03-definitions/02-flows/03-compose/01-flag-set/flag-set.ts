/**
 * composeFlagsForFlow — the per-flow flag composer.
 *
 * Reads a FlowSpec plus runtime data (the universal Param Surface
 * catalog and `Models.list()`) and produces the FlagSet that an oclif
 * command spreads into `static flags = {...}`.
 *
 * Pipeline:
 *   1. Apply `flow.modelFilter` to the model list → allowed-id set.
 *   2. Narrow the universal catalog to those ids via `filterCatalog`.
 *   3. Generate descriptor-derived flags from the narrowed catalog
 *      (Param Surface's `flag-schema`).
 *   4. Spread the FlowSpec's `staticFlagGroups` from `STATIC_FLAG_GROUPS`.
 *   5. Merge: descriptor flags first, then static groups — static wins
 *      on the (rare, test-asserted) collision.
 *
 * Pure function. Caller injects all deps. No singletons.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import type { Catalog } from '#param-surface';
import { generateFlagsFromCatalog } from '#param-surface';
import { STATIC_FLAG_GROUPS, type StaticFlagSet } from '../../01-static/01-static-flags/index.ts';
import { filterCatalog } from '../../01-static/03-catalog-filter/index.ts';
import type { FlowSpec } from '../../02-registry/01-flow-spec/index.ts';
import { sdkGapFlags } from './sdk-gap-flags.ts';

/** Spreadable into an oclif command's `static flags = {...}`. */
export type FlagSet = Record<string, unknown>;

export function composeFlagsForFlow(flow: FlowSpec, catalog: Catalog, models: readonly ModelDefinition[]): FlagSet {
  const allowedIds = new Set<string>();
  for (const model of models) {
    if (flow.modelFilter(model)) allowedIds.add(model.id);
  }

  const filtered = filterCatalog(catalog, allowedIds);
  const descriptorFlags = generateFlagsFromCatalog(filtered);

  const staticFlags: StaticFlagSet = {};
  for (const groupName of flow.staticFlagGroups) {
    Object.assign(staticFlags, STATIC_FLAG_GROUPS[groupName]);
  }

  // Descriptor flags first, then the SDK-gap overlay (fields buildPayload
  // reads without a descriptor — see ./sdk-gap-flags.ts), then static.
  // The cross-block collision test in `01-static-flags/static-flags.test.ts`
  // guarantees no overlap on the fixture catalog; this merge order ensures
  // static wins if a real-SDK collision ever slips through.
  return { ...descriptorFlags, ...sdkGapFlags(allowedIds), ...staticFlags };
}

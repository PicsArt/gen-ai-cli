/**
 * Catalog Filter — produce a Catalog view scoped to a subset of models.
 *
 * Why this exists:
 *
 *   Param Surface builds one universal catalog from `Models.list()` —
 *   every flag from every model is in there. A flow (e.g. `remove-bg`)
 *   only cares about a subset of models, so this primitive narrows the
 *   catalog before composers render flags or wizard steps.
 *
 * Why a `Set<string>` of model ids instead of a `(model) => boolean`:
 *
 *   The catalog stores only model ids on each surface (not full model
 *   objects), so a predicate would need both the catalog AND the model
 *   list to apply. Pushing the predicate one layer up (composer applies
 *   `flow.modelFilter` to `Models.list()` to derive the id set) keeps
 *   this primitive small and self-contained.
 *
 * Behavior:
 *   - drop surfaces whose `models[]` contains no id in the allowed set
 *   - for kept surfaces, trim metadata to only the allowed ids:
 *       models, requiredInModels, perModelLabels, descriptorsByModel
 *   - RE-MERGE the descriptor (and conflicts) from the allowed models'
 *     own descriptors via Param Surface's `mergeDescriptors`, so enum
 *     options / kinds contributed only by excluded models don't leak
 *     into the narrowed view
 *   - rebuild bySdkKey / byFlag maps from the kept surfaces
 *   - preserve the alphabetical-by-key order Param Surface promised
 *
 * Pure function. No I/O. Does not mutate input.
 */
import type { ParamDescriptor } from '@picsart/ai-sdk';
import type { Catalog, ParamSurface } from '#param-surface';
import { mergeDescriptors } from '#param-surface';

export function filterCatalog(catalog: Catalog, allowedModelIds: ReadonlySet<string>): Catalog {
  const kept: ParamSurface[] = [];
  for (const surface of catalog.all()) {
    if (!surface.models.some((id) => allowedModelIds.has(id))) continue;
    kept.push(trimSurface(surface, allowedModelIds));
  }

  const bySdkKey = new Map<string, ParamSurface>();
  const byFlag = new Map<string, ParamSurface>();
  for (const surface of kept) {
    bySdkKey.set(surface.key, surface);
    byFlag.set(surface.flag, surface);
    for (const alias of surface.flagAliases) byFlag.set(alias, surface);
  }

  return {
    bySdkKey,
    byFlag,
    all: () => kept,
  };
}

function trimSurface(surface: ParamSurface, allowed: ReadonlySet<string>): ParamSurface {
  const models = surface.models.filter((id) => allowed.has(id));
  const requiredInModels = surface.requiredInModels.filter((id) => allowed.has(id));
  const perModelLabels = new Map<string, string>();
  for (const [id, label] of surface.perModelLabels) {
    if (allowed.has(id)) perModelLabels.set(id, label);
  }
  const descriptorsByModel = new Map<string, ParamDescriptor>();
  for (const [id, desc] of surface.descriptorsByModel) {
    if (allowed.has(id)) descriptorsByModel.set(id, desc);
  }
  const merged = mergeDescriptors(descriptorsByModel);

  return {
    ...surface,
    descriptor: merged.descriptor,
    descriptorsByModel,
    models,
    requiredInModels,
    perModelLabels,
    conflicts: merged.conflicts,
  };
}

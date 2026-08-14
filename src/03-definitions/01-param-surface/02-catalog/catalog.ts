/**
 * Block 3 — Catalog.
 *
 * What it does, in one sentence:
 *   Walks every SDK model's paramConfig and produces ONE lookup table
 *   the CLI can use to know all the flags any model accepts.
 *
 * The data flow:
 *
 *   Models.list()              loadCatalog              Catalog
 *   ─────────────────────  →  ──────────────────  →  ─────────────────
 *   [ modelA, modelB, … ]      merge by key,            bySdkKey / byFlag /
 *   each with paramConfig      union enum options,      all() — pointing to
 *                              apply aliases            ParamSurface objects
 *
 * Each ParamSurface answers: "for this parameter (e.g. aspectRatio),
 * what's the CLI flag name, the short char if any, the descriptor I
 * should validate against, and which models declared it?"
 *
 * Tests pass hand-built fixture models to loadCatalog. Production code
 * calls getCatalog() which lazily walks the real Models.list() and
 * caches the result for the rest of the process.
 *
 * See README.md for a walked example.
 */
import {
  type EnumDescriptor,
  type EnumOption,
  type ModelDefinition,
  Models,
  type ParamDescriptor,
} from '@picsart/ai-sdk';
import { ALIAS_MAP, type AliasMap } from '../01-primitives/01-aliases/index.ts';
import { camelToKebab } from '../01-primitives/02-coercion/index.ts';

/* ─────────────────────────────────────────────────────────────────────── */
/*  Public types                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Everything the CLI needs to know about a single parameter, merged
 * across every model that declares it.
 */
export interface ParamSurface {
  /** SDK descriptor key (camelCase), e.g. 'aspectRatio'. */
  key: string;
  /** CLI flag name (kebab-case), e.g. 'aspect-ratio'. */
  flag: string;
  /** Single-character short alias, e.g. 'p' for prompt. From ALIAS_MAP. */
  char?: string;
  /** Extra long-form aliases, e.g. ['ar'] for aspect-ratio. From ALIAS_MAP. */
  flagAliases: readonly string[];
  /**
   * The merged descriptor. For enums whose options differ across models,
   * the options are unioned. For other kinds, the first descriptor seen
   * wins. When models disagree on `kind`, the first kind wins and the
   * divergent ones are recorded in `conflicts`.
   */
  descriptor: ParamDescriptor;
  /**
   * Each declaring model's own (unmerged) descriptor. Lets a narrowed
   * view (see Flows' `filterCatalog`) re-merge from a model subset so
   * excluded models' enum options / kinds don't leak into a flow.
   */
  descriptorsByModel: ReadonlyMap<string, ParamDescriptor>;
  /** Every model id that declares this parameter, in insertion order. */
  models: readonly string[];
  /** Subset of `models` where the entry was marked required. */
  requiredInModels: readonly string[];
  /** Per-model label — only models that supplied one are listed. */
  perModelLabels: ReadonlyMap<string, string>;
  /** Models whose descriptor kind diverges from the primary. Empty when
   *  the surface is internally consistent. */
  conflicts: readonly ParamSurfaceConflict[];
}

export interface ParamSurfaceConflict {
  modelId: string;
  /** 'text' | 'range' | 'boolean' | 'file' | 'object' | 'enum:string' | 'enum:number'. */
  kind: string;
  descriptor: ParamDescriptor;
}

export interface LoadCatalogOptions {
  /**
   * When true, throw `ParamConflictError` on the first kind-conflict.
   * Default false — conflicts are tracked on the surface and downstream
   * consumers decide how to handle them. Strict mode is for unit tests
   * and the `dev:params` drift-detector command.
   */
  strict?: boolean;
}

export interface Catalog {
  /** Look up a parameter by its SDK camelCase key. */
  bySdkKey: ReadonlyMap<string, ParamSurface>;
  /** Look up a parameter by ANY of its CLI flag names — primary or alias. */
  byFlag: ReadonlyMap<string, ParamSurface>;
  /** All surfaces, sorted alphabetically by key. */
  all(): readonly ParamSurface[];
}

/** Minimum shape `loadCatalog` reads from a model. Real SDK models satisfy this. */
export type ModelLike = Pick<ModelDefinition, 'id' | 'paramConfig'>;

/* ─────────────────────────────────────────────────────────────────────── */
/*  ParamConflictError                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Thrown by `loadCatalog` in strict mode when two models declare the same
 * descriptor key with incompatible kinds (e.g. one says `text`, the other
 * says `range`). The error names every conflicting model and its kind.
 */
export class ParamConflictError extends Error {
  readonly key: string;
  readonly modelIds: readonly string[];

  constructor(key: string, kindsByModel: ReadonlyMap<string, string>) {
    const detail = [...kindsByModel.entries()].map(([id, kind]) => `${id}: ${kind}`).join(', ');
    super(`Descriptor key '${key}' declared with conflicting kinds — ${detail}`);
    this.name = 'ParamConflictError';
    this.key = key;
    this.modelIds = [...kindsByModel.keys()];
  }
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  loadCatalog                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Where each parameter's merged state lives while we walk the models.
 * One bucket per unique SDK key. Promoted to a `ParamSurface` at the end.
 */
interface Bucket {
  /** Each declaring model's own descriptor, in walk order. */
  descriptorsByModel: Map<string, ParamDescriptor>;
  models: string[];
  requiredInModels: string[];
  perModelLabels: Map<string, string>;
  /** model-id → 'text' | 'range' | 'enum:string' | etc. Used to detect mismatches. */
  kindsByModel: Map<string, string>;
}

/** A short string that uniquely identifies a descriptor's shape. */
function kindOf(d: ParamDescriptor): string {
  return d.kind === 'enum' ? `enum:${d.valueType}` : d.kind;
}

export function loadCatalog(
  models: readonly ModelLike[],
  aliases: AliasMap,
  options: LoadCatalogOptions = {},
): Catalog {
  const buckets = new Map<string, Bucket>();

  // ── Pass 1: walk every model's paramConfig and fill the buckets. ──
  // Merging is deferred to `mergeDescriptors` in pass 2 so the exact
  // same merge runs when Flows' `filterCatalog` narrows to a model subset.
  for (const model of models) {
    for (const [key, entry] of Object.entries(model.paramConfig)) {
      const desc = entry.descriptor;
      const kind = kindOf(desc);
      const existing = buckets.get(key);

      // First time we've seen this key — open a new bucket.
      if (!existing) {
        buckets.set(key, {
          descriptorsByModel: new Map([[model.id, desc]]),
          models: [model.id],
          requiredInModels: entry.required ? [model.id] : [],
          perModelLabels: entry.label !== undefined ? new Map([[model.id, entry.label]]) : new Map(),
          kindsByModel: new Map([[model.id, kind]]),
        });
        continue;
      }

      // Bucket exists. Record this model's contribution.
      existing.descriptorsByModel.set(model.id, desc);
      existing.kindsByModel.set(model.id, kind);
      existing.models.push(model.id);
      if (entry.required) existing.requiredInModels.push(model.id);
      if (entry.label !== undefined) existing.perModelLabels.set(model.id, entry.label);

      if (options.strict && kind !== kindOf(existing.descriptorsByModel.values().next().value as ParamDescriptor)) {
        throw new ParamConflictError(key, existing.kindsByModel);
      }
    }
  }

  // ── Pass 2: turn each bucket into a ParamSurface and build the maps. ──
  //
  // Flag registration is two-phase so a collision can never silently
  // overwrite an entry (SDK 5 landed a real `format` key next to the
  // historic `outputFormat → --format` alias — the alias must yield):
  //   Phase A: primary flags. Two keys resolving to the same primary flag
  //            is a configuration error → throw.
  //   Phase B: long-form aliases, in key-sorted order for determinism.
  //            An alias that collides with any primary flag or an earlier
  //            alias is DROPPED from the surface so oclif never sees it.
  const sortedKeys = [...buckets.keys()].sort((a, b) => a.localeCompare(b));

  const primaryFlagByKey = new Map<string, string>();
  const flagHolder = new Map<string, string>(); // flag/alias name → owning key
  for (const key of sortedKeys) {
    const flag = aliases[key]?.flag ?? camelToKebab(key);
    const holder = flagHolder.get(flag);
    if (holder !== undefined) {
      throw new Error(
        `loadCatalog: keys '${holder}' and '${key}' both resolve to the primary flag '--${flag}'. ` +
          'Adjust ALIAS_MAP so every key has a distinct flag name.',
      );
    }
    flagHolder.set(flag, key);
    primaryFlagByKey.set(key, flag);
  }

  const bySdkKey = new Map<string, ParamSurface>();
  const byFlag = new Map<string, ParamSurface>();

  for (const key of sortedKeys) {
    const bucket = buckets.get(key) as Bucket;
    const alias = aliases[key];
    const flag = primaryFlagByKey.get(key) as string;

    const flagAliases: string[] = [];
    for (const long of alias?.aliases ?? []) {
      if (flagHolder.has(long)) continue; // taken by a primary flag or an earlier alias
      flagHolder.set(long, key);
      flagAliases.push(long);
    }

    const merged = mergeDescriptors(bucket.descriptorsByModel);

    const surface: ParamSurface = {
      key,
      flag,
      char: alias?.char,
      flagAliases,
      descriptor: merged.descriptor,
      descriptorsByModel: bucket.descriptorsByModel,
      models: bucket.models,
      requiredInModels: bucket.requiredInModels,
      perModelLabels: bucket.perModelLabels,
      conflicts: merged.conflicts,
    };

    bySdkKey.set(key, surface);
    byFlag.set(flag, surface);
    for (const long of flagAliases) byFlag.set(long, surface);
  }

  const sorted = [...bySdkKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  return {
    bySdkKey,
    byFlag,
    all: () => sorted,
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Descriptor merge                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

export interface MergedDescriptor {
  descriptor: ParamDescriptor;
  conflicts: ParamSurfaceConflict[];
}

/**
 * Merge one parameter's per-model descriptors into a single surface
 * descriptor: first-seen kind wins, same-kind enums union their options,
 * kind divergences are recorded as conflicts.
 *
 * The single source of truth for merge semantics — `loadCatalog` uses it
 * for the universal view and Flows' `filterCatalog` re-runs it on a model
 * subset so a narrowed catalog never leaks excluded models' options.
 */
export function mergeDescriptors(descriptorsByModel: ReadonlyMap<string, ParamDescriptor>): MergedDescriptor {
  let primary: ParamDescriptor | undefined;
  const conflicts: ParamSurfaceConflict[] = [];

  for (const [modelId, desc] of descriptorsByModel) {
    if (primary === undefined) {
      primary = desc;
      continue;
    }
    if (kindOf(desc) !== kindOf(primary)) {
      conflicts.push({ modelId, kind: kindOf(desc), descriptor: desc });
      continue;
    }
    if (desc.kind === 'enum' && primary.kind === 'enum') {
      primary = unionEnumOptions(primary, desc);
    }
    // For other kinds (text, range, boolean, catalog, file, object) the
    // first descriptor stays as-is. We don't try to reconcile differing
    // maxLength / min-max / step values across models.
  }

  if (primary === undefined) {
    throw new Error('mergeDescriptors: no descriptors to merge');
  }
  return { descriptor: primary, conflicts };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Enum-option union                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

type AnyEnum = EnumDescriptor<string> | EnumDescriptor<number>;

/**
 * Two enum descriptors with the same valueType: union their options by id,
 * keeping the first occurrence of each. Used when multiple models declare
 * the same key with different `options` arrays (e.g. aspectRatio with
 * different ratio sets across models).
 */
function unionEnumOptions(a: AnyEnum, b: AnyEnum): AnyEnum {
  // Caller already verified valueType matches, so `id` types align.
  const seen = new Map<string | number, EnumOption<string | number>>();
  for (const opt of a.options) seen.set(opt.id, opt as EnumOption<string | number>);
  for (const opt of b.options) {
    if (!seen.has(opt.id)) seen.set(opt.id, opt as EnumOption<string | number>);
  }
  return { ...a, options: [...seen.values()] } as AnyEnum;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  getCatalog — production accessor (memoized)                           */
/* ─────────────────────────────────────────────────────────────────────── */

let _cached: Catalog | undefined;

/**
 * Production accessor. Builds the catalog from the real SDK on first call
 * and caches it for the rest of the process. Tests call `loadCatalog` directly
 * with fixture models and never touch this.
 */
export function getCatalog(): Catalog {
  if (_cached) return _cached;
  _cached = loadCatalog(Models.list(), ALIAS_MAP);
  return _cached;
}

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
  descriptor: ParamDescriptor;
  models: string[];
  requiredInModels: string[];
  perModelLabels: Map<string, string>;
  /** model-id → 'text' | 'range' | 'enum:string' | etc. Used to detect mismatches. */
  kindsByModel: Map<string, string>;
  /** Models that disagreed on kind with the bucket's primary descriptor. */
  conflicts: ParamSurfaceConflict[];
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
  for (const model of models) {
    for (const [key, entry] of Object.entries(model.paramConfig)) {
      const desc = entry.descriptor;
      const kind = kindOf(desc);
      const existing = buckets.get(key);

      // First time we've seen this key — open a new bucket.
      if (!existing) {
        buckets.set(key, {
          descriptor: desc,
          models: [model.id],
          requiredInModels: entry.required ? [model.id] : [],
          perModelLabels: entry.label !== undefined ? new Map([[model.id, entry.label]]) : new Map(),
          kindsByModel: new Map([[model.id, kind]]),
          conflicts: [],
        });
        continue;
      }

      // Bucket exists. Record this model's contribution.
      existing.kindsByModel.set(model.id, kind);
      existing.models.push(model.id);
      if (entry.required) existing.requiredInModels.push(model.id);
      if (entry.label !== undefined) existing.perModelLabels.set(model.id, entry.label);

      // Does this model's kind match the bucket's primary?
      const primaryKind = kindOf(existing.descriptor);
      if (kind !== primaryKind) {
        if (options.strict) {
          throw new ParamConflictError(key, existing.kindsByModel);
        }
        // Permissive: first-seen wins, record the divergence and move on.
        existing.conflicts.push({ modelId: model.id, kind, descriptor: desc });
        continue;
      }

      // Same kind. If it's an enum, union the options.
      if (desc.kind === 'enum' && existing.descriptor.kind === 'enum') {
        existing.descriptor = unionEnumOptions(existing.descriptor, desc);
      }
      // For other kinds (text, range, boolean, file, object) the first
      // descriptor stays as-is. We don't try to reconcile differing
      // maxLength / min-max / step values across models.
    }
  }

  // ── Pass 2: turn each bucket into a ParamSurface and build the maps. ──
  const bySdkKey = new Map<string, ParamSurface>();
  const byFlag = new Map<string, ParamSurface>();

  for (const [key, bucket] of buckets) {
    const alias = aliases[key];
    const flag = alias?.flag ?? camelToKebab(key);
    const flagAliases = alias?.aliases ?? [];

    const surface: ParamSurface = {
      key,
      flag,
      char: alias?.char,
      flagAliases,
      descriptor: bucket.descriptor,
      models: bucket.models,
      requiredInModels: bucket.requiredInModels,
      perModelLabels: bucket.perModelLabels,
      conflicts: bucket.conflicts,
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

/**
 * Drift auditor — pure inspection over a loaded Catalog.
 *
 * Walks the catalog and answers "is the CLI-side surface in sync with
 * the SDK paramConfig descriptors?" The structured `AuditReport` is
 * shared by two renderers:
 *
 *   - `scripts/audit-params.ts`    — human-friendly terminal output
 *                                    via `npm run audit:params`
 *   - `gen-ai dev:params`          — same data, oclif-rendered, with
 *                                    --json for CI gating
 *
 * Pure function. No I/O. No singletons. Caller injects the catalog
 * and the set of expected orphan keys.
 */
import type { Catalog, ParamSurface } from '../02-catalog/index.ts';
import type { FileWiringGap } from './file-wiring.ts';

const LONG_FLAG_THRESHOLD = 15;

/** A descriptor with no `ALIAS_MAP` entry — uses derived kebab name. */
export interface NoAliasEntry {
  key: string;
  flag: string;
}

/** A flag whose name length crosses the readability threshold. */
export interface LongFlagEntry {
  flag: string;
  length: number;
  /** Short aliases already configured (chars + flagAliases). */
  aliases: readonly string[];
}

/** A key in `ALIAS_MAP` that doesn't point at a real SDK descriptor. */
export interface OrphanEntry {
  alias: string;
  /** True when the orphan is documented in the SDK gap list. */
  expected: boolean;
}

/** A descriptor merged permissively across models with different kinds. */
export interface ConflictEntry {
  key: string;
  primaryKind: string;
  conflicts: ReadonlyArray<{ kind: string; modelId: string }>;
}

export interface AuditReport {
  readonly totalSurfaces: number;
  readonly withAlias: number;
  readonly withoutAlias: number;
  readonly noAlias: readonly NoAliasEntry[];
  readonly longFlags: readonly LongFlagEntry[];
  readonly orphans: readonly OrphanEntry[];
  readonly unexpectedOrphans: readonly string[];
  readonly closedGaps: readonly string[];
  readonly conflicts: readonly ConflictEntry[];
  /**
   * File-kind descriptors whose `files.<slot>` is missing from the
   * resolver and/or one of the executor paths. Computed by
   * `findFileWiringGaps` (separate module — needs source-file I/O) and
   * passed in via options. Empty when the caller didn't run the check.
   */
  readonly fileWiringGaps: readonly FileWiringGap[];
  /** True when the catalog has at least one drift item (CI gate). */
  readonly hasActionItems: boolean;
}

/**
 * Produce a structured audit of `catalog` against `aliasKeys`.
 *
 * - `aliasKeys`        — every key declared in `ALIAS_MAP`
 * - `expectedOrphans`  — keys allowed to be in ALIAS_MAP without a real
 *                       SDK descriptor (documented gaps)
 *
 * Caller may set `longFlagThreshold` to override the 15-char default.
 */
export function auditCatalog(
  catalog: Catalog,
  aliasKeys: ReadonlySet<string>,
  expectedOrphans: ReadonlySet<string>,
  options: {
    longFlagThreshold?: number;
    /**
     * Pre-computed file-wiring gaps (see `findFileWiringGaps` in
     * `file-wiring.ts`). Kept as an injected parameter so this function
     * stays pure — only the script / oclif command does the source-file
     * reads. Defaults to empty when the caller skips the check.
     */
    fileWiringGaps?: readonly FileWiringGap[];
  } = {},
): AuditReport {
  const threshold = options.longFlagThreshold ?? LONG_FLAG_THRESHOLD;
  const fileWiringGaps = options.fileWiringGaps ?? [];
  const all = catalog.all();

  const noAlias: NoAliasEntry[] = [];
  const longFlags: LongFlagEntry[] = [];
  const conflicts: ConflictEntry[] = [];

  for (const surface of all) {
    if (!aliasKeys.has(surface.key)) {
      noAlias.push({ key: surface.key, flag: surface.flag });
    }
    if (surface.flag.length > threshold) {
      const aliases = collectAliases(surface);
      longFlags.push({ flag: surface.flag, length: surface.flag.length, aliases });
    }
    if (surface.conflicts.length > 0) {
      conflicts.push({
        key: surface.key,
        primaryKind: formatKind(surface),
        conflicts: surface.conflicts.map((c) => ({ kind: c.kind, modelId: c.modelId })),
      });
    }
  }

  const orphans: OrphanEntry[] = [];
  const unexpectedOrphans: string[] = [];
  for (const key of aliasKeys) {
    if (catalog.bySdkKey.has(key)) continue;
    const expected = expectedOrphans.has(key);
    orphans.push({ alias: key, expected });
    if (!expected) unexpectedOrphans.push(key);
  }

  const closedGaps: string[] = [];
  for (const key of expectedOrphans) {
    if (catalog.bySdkKey.has(key)) closedGaps.push(key);
  }

  const withAlias = all.filter((s) => aliasKeys.has(s.key)).length;

  return {
    totalSurfaces: all.length,
    withAlias,
    withoutAlias: all.length - withAlias,
    noAlias,
    longFlags,
    orphans,
    unexpectedOrphans,
    closedGaps,
    conflicts,
    fileWiringGaps,
    hasActionItems: unexpectedOrphans.length > 0 || closedGaps.length > 0 || fileWiringGaps.length > 0,
  };
}

function collectAliases(surface: ParamSurface): readonly string[] {
  const out: string[] = [];
  if (surface.char !== undefined) out.push(surface.char);
  for (const a of surface.flagAliases) out.push(a);
  return out;
}

function formatKind(surface: ParamSurface): string {
  const d = surface.descriptor;
  if (d.kind === 'enum') return `enum:${d.valueType}`;
  return d.kind;
}

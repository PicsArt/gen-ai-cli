/**
 * File-slot wiring auditor — catches descriptors that are declared but
 * not threaded through the resolver/execute/validate pipeline.
 *
 * Why this exists: Param Surface auto-derives the FLAG declaration for
 * every SDK descriptor (so `--video-urls` shows up in `--help`), but the
 * flag-reader explicitly skips `file`-kind values — those are owned by
 * the resolver's file pipeline. If a new file-kind descriptor lands
 * without matching wiring in `resolver.ts` / `execute.ts` / `validate.ts`,
 * the flag silently drops its value and the model rejects at the API
 * layer with a cryptic 400. This module flags that class of bug at
 * audit time so CI fails locally instead.
 *
 * Pure: no I/O. The caller reads the three source files (see
 * `source-reader.ts`) and passes contents in as plain strings.
 */
import type { Catalog } from '../02-catalog/index.ts';

/**
 * One unwired file-slot. At least one of `resolverMiss` / `executeMiss` /
 * `validateMiss` is true when the entry is reported.
 */
export interface FileWiringGap {
  /** SDK descriptor key (camelCase), e.g. `videoUrls`. */
  sdkKey: string;
  /** Internal `files.<key>` slot name, e.g. `videos`. Empty when unmapped. */
  filesKey: string;
  /** True when the descriptor declares an array shape (`array: { … }`). */
  isArray: boolean;
  /** No `files.<filesKey>` write in `04-pipeline/02-resolve/scripted/resolver.ts`. */
  resolverMiss: boolean;
  /** No `files.<filesKey>` read in `04-pipeline/03-execution/execute.ts`. */
  executeMiss: boolean;
  /** No `files.<filesKey>` read in `04-pipeline/03-execution/validate.ts`. */
  validateMiss: boolean;
  /**
   * True when the SDK exposed a `file`-kind descriptor whose key has no
   * entry in `FILES_KEY_BY_SDK_KEY`. The CLI doesn't know how to map it
   * to a `files.<X>` slot — either add the mapping here or rename the
   * descriptor on the SDK side to reuse an existing slot.
   */
  unmappedKey: boolean;
}

/** Source-file contents the auditor greps. Caller is responsible for reads. */
export interface ResolverSources {
  resolver: string;
  execute: string;
  validate: string;
}

/**
 * SDK descriptor key → internal `files.<slot>` name.
 *
 * Source of truth for which file-kind descriptors the CLI knows how to
 * resolve. Stays in sync with the explicit branches in
 * `04-pipeline/02-resolve/scripted/resolver.ts`. Add an entry here when
 * a new file-kind descriptor lands on the SDK side and you've wired the
 * matching resolver/execute/validate branches.
 */
export const FILES_KEY_BY_SDK_KEY: Readonly<Record<string, { filesKey: string; isArray: boolean }>> = {
  imageUrls: { filesKey: 'images', isArray: true },
  videoUrls: { filesKey: 'videos', isArray: true },
  audioUrls: { filesKey: 'audios', isArray: true },
  startFrame: { filesKey: 'startFrame', isArray: false },
  endFrame: { filesKey: 'endFrame', isArray: false },
  videoUrl: { filesKey: 'video', isArray: false },
  audioUrl: { filesKey: 'audio', isArray: false },
  staticMask: { filesKey: 'staticMask', isArray: false },
  sceneImage: { filesKey: 'sceneImage', isArray: false },
  styleImage: { filesKey: 'styleImage', isArray: false },
  styleReferenceUrls: { filesKey: 'styleReferences', isArray: true },
};

/**
 * Walk every file-kind descriptor in `catalog` and verify each is wired
 * through the resolver and both executor paths.
 *
 * The presence check is textual — a word-boundary regex on
 * `files.<slot>`, NOT a plain substring: `files.videos` must never count
 * as wiring for the singular `files.video` slot. A refactor that
 * destructures `files` (e.g. `const { videos } = files`) would still
 * fool the grep — guard against that with a regression unit test on the
 * resolver shape.
 */
export function findFileWiringGaps(catalog: Catalog, sources: ResolverSources): readonly FileWiringGap[] {
  const gaps: FileWiringGap[] = [];

  for (const surface of catalog.all()) {
    if (surface.descriptor.kind !== 'file') continue;
    const mapping = FILES_KEY_BY_SDK_KEY[surface.key];

    if (!mapping) {
      gaps.push({
        sdkKey: surface.key,
        filesKey: '',
        isArray: !!surface.descriptor.array,
        resolverMiss: true,
        executeMiss: true,
        validateMiss: true,
        unmappedKey: true,
      });
      continue;
    }

    const needle = slotNeedle(mapping.filesKey);
    const resolverMiss = !needle.test(sources.resolver);
    const executeMiss = !needle.test(sources.execute);
    const validateMiss = !needle.test(sources.validate);

    if (resolverMiss || executeMiss || validateMiss) {
      gaps.push({
        sdkKey: surface.key,
        filesKey: mapping.filesKey,
        isArray: mapping.isArray,
        resolverMiss,
        executeMiss,
        validateMiss,
        unmappedKey: false,
      });
    }
  }

  return gaps;
}

/**
 * `files.<slot>` with an identifier boundary after the slot name, so a
 * wired `files.videos` never masquerades as the singular `files.video`.
 */
function slotNeedle(filesKey: string): RegExp {
  return new RegExp(`files\\.${filesKey}(?![A-Za-z0-9_$])`);
}

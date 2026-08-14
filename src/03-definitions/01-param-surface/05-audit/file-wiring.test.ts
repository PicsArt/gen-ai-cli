/**
 * Spec for the file-wiring auditor.
 *
 * The function is pure — it takes the merged catalog plus three source
 * strings (resolver/execute/validate) and reports descriptors whose
 * `files.<slot>` is missing from any of them. Tests use synthetic
 * source strings so we don't depend on the real pipeline files (which
 * keep growing).
 */
import { describe, expect, it } from 'vitest';
import { MODEL_FILE } from '../__test-utils__/models-min.ts';
import { ALIAS_MAP } from '../01-primitives/01-aliases/index.ts';
import { loadCatalog, type ModelLike } from '../02-catalog/index.ts';
import { findFileWiringGaps, type ResolverSources } from './file-wiring.ts';

function makeCatalog(models: readonly ModelLike[]) {
  return loadCatalog(models, ALIAS_MAP);
}

function makeSources(overrides: Partial<ResolverSources> = {}): ResolverSources {
  return {
    resolver: 'files.images\nfiles.startFrame\nfiles.endFrame\nfiles.video\nfiles.audio\nfiles.videos\nfiles.audios',
    execute: 'files.images\nfiles.startFrame\nfiles.endFrame\nfiles.video\nfiles.audio\nfiles.videos\nfiles.audios',
    validate: 'files.images\nfiles.startFrame\nfiles.endFrame\nfiles.video\nfiles.audio\nfiles.videos\nfiles.audios',
    ...overrides,
  };
}

describe('findFileWiringGaps — happy path', () => {
  it('reports nothing when every file slot appears in all three sources', () => {
    const catalog = makeCatalog([MODEL_FILE]);
    const gaps = findFileWiringGaps(catalog, makeSources());
    expect(gaps).toEqual([]);
  });

  it('skips non-file descriptors entirely', () => {
    const promptOnly: ModelLike = {
      id: 'fx-prompt',
      paramConfig: { prompt: { descriptor: { kind: 'text' } } },
    };
    const catalog = makeCatalog([promptOnly]);
    const gaps = findFileWiringGaps(catalog, { resolver: '', execute: '', validate: '' });
    expect(gaps).toEqual([]);
  });
});

describe('findFileWiringGaps — missing wiring', () => {
  it('flags resolverMiss when files.<slot> is absent from resolver.ts', () => {
    const catalog = makeCatalog([MODEL_FILE]);
    const gaps = findFileWiringGaps(catalog, makeSources({ resolver: '' }));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      sdkKey: 'imageUrls',
      filesKey: 'images',
      resolverMiss: true,
      executeMiss: false,
      validateMiss: false,
      unmappedKey: false,
    });
  });

  it('flags executeMiss when files.<slot> is absent from execute.ts', () => {
    const catalog = makeCatalog([MODEL_FILE]);
    const gaps = findFileWiringGaps(catalog, makeSources({ execute: '' }));
    expect(gaps[0].executeMiss).toBe(true);
    expect(gaps[0].resolverMiss).toBe(false);
  });

  it('flags validateMiss when files.<slot> is absent from validate.ts', () => {
    const catalog = makeCatalog([MODEL_FILE]);
    const gaps = findFileWiringGaps(catalog, makeSources({ validate: '' }));
    expect(gaps[0].validateMiss).toBe(true);
  });

  it('does NOT treat a wired plural slot as covering the singular (files.videos vs files.video)', () => {
    // Substring matching would pass `files.video` because `files.videos`
    // contains it — leaving the auditor permanently blind to a missing
    // singular slot. The needle must respect the identifier boundary.
    const singleVideo: ModelLike = {
      id: 'fx-single-video',
      paramConfig: {
        videoUrl: { descriptor: { kind: 'file', accept: 'video' } },
      },
    };
    const catalog = makeCatalog([singleVideo]);
    // Sources wire ONLY the plural slot.
    const pluralOnly = 'files.videos\nfiles.audios';
    const gaps = findFileWiringGaps(catalog, { resolver: pluralOnly, execute: pluralOnly, validate: pluralOnly });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      sdkKey: 'videoUrl',
      filesKey: 'video',
      resolverMiss: true,
      executeMiss: true,
      validateMiss: true,
    });
  });

  it('records the regression we shipped before this audit existed (videoUrls dropped from resolver)', () => {
    // Synthetic model with the same shape seedance-2.0-video-extend has —
    // descriptor exists, but resolver.ts has no `files.videos = …` line.
    const videoExtend: ModelLike = {
      id: 'fx-video-extend',
      paramConfig: {
        videoUrls: { descriptor: { kind: 'file', accept: 'video', array: { max: 2 } } },
      },
    };
    const catalog = makeCatalog([videoExtend]);
    const sources = makeSources({ resolver: 'files.images\nfiles.startFrame' }); // no files.videos
    const gaps = findFileWiringGaps(catalog, sources);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].sdkKey).toBe('videoUrls');
    expect(gaps[0].filesKey).toBe('videos');
    expect(gaps[0].resolverMiss).toBe(true);
  });
});

describe('findFileWiringGaps — unmapped SDK key', () => {
  it('flags an unknown file-kind key with unmappedKey=true and all three misses', () => {
    const exoticFile: ModelLike = {
      id: 'fx-exotic',
      paramConfig: {
        // A SDK file-kind key the CLI has never heard of.
        weirdNewSlot: { descriptor: { kind: 'file', accept: 'image' } },
      },
    };
    const catalog = makeCatalog([exoticFile]);
    const gaps = findFileWiringGaps(catalog, makeSources());
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      sdkKey: 'weirdNewSlot',
      filesKey: '',
      unmappedKey: true,
      resolverMiss: true,
      executeMiss: true,
      validateMiss: true,
    });
  });
});

describe('findFileWiringGaps — array vs single', () => {
  it('preserves isArray=true for array-shape descriptors', () => {
    const catalog = makeCatalog([MODEL_FILE]); // imageUrls is array
    const gaps = findFileWiringGaps(catalog, makeSources({ resolver: '' }));
    expect(gaps[0].isArray).toBe(true);
  });

  it('preserves isArray=false for single-file descriptors', () => {
    const singleFrame: ModelLike = {
      id: 'fx-start-frame',
      paramConfig: { startFrame: { descriptor: { kind: 'file', accept: 'image' } } },
    };
    const catalog = makeCatalog([singleFrame]);
    const gaps = findFileWiringGaps(catalog, makeSources({ resolver: '' }));
    expect(gaps[0].isArray).toBe(false);
  });
});

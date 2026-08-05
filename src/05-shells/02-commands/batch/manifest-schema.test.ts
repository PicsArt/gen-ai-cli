/**
 * Spec for the batch manifest schema + structural validator.
 */
import { describe, expect, it } from 'vitest';
import { BATCH_MANIFEST_SCHEMA, validateManifestStructure } from './manifest-schema.ts';

describe('validateManifestStructure', () => {
  it('accepts a valid manifest (defaults + extra job params allowed)', () => {
    const manifest = {
      defaults: { model: 'flux-1.1-pro', aspectRatio: '16:9' },
      jobs: [
        { id: 'a', prompt: 'one', aspectRatio: '1:1' },
        { id: 'b', model: 'veo-3.1', prompt: 'two' },
      ],
    };
    expect(validateManifestStructure(manifest)).toEqual([]);
  });

  it('rejects a non-object', () => {
    expect(validateManifestStructure([])).toHaveLength(1);
    expect(validateManifestStructure('nope')).toHaveLength(1);
  });

  it('rejects a missing / non-array / empty jobs list', () => {
    expect(validateManifestStructure({})).not.toEqual([]);
    expect(validateManifestStructure({ jobs: {} })).not.toEqual([]);
    expect(validateManifestStructure({ jobs: [] })).not.toEqual([]);
  });

  it('requires a non-empty string id on every job', () => {
    expect(validateManifestStructure({ jobs: [{ prompt: 'x' }] })[0]).toMatch(/id/);
    expect(validateManifestStructure({ jobs: [{ id: '' }] })[0]).toMatch(/id/);
  });

  it('flags duplicate ids', () => {
    const errors = validateManifestStructure({ jobs: [{ id: 'dup' }, { id: 'dup' }] });
    expect(errors.some((e) => /Duplicate job id "dup"/.test(e))).toBe(true);
  });

  it('flags a non-string model', () => {
    const errors = validateManifestStructure({ jobs: [{ id: 'a', model: 123 }] });
    expect(errors.some((e) => /model/.test(e))).toBe(true);
  });

  it('flags a non-object defaults', () => {
    expect(validateManifestStructure({ defaults: [], jobs: [{ id: 'a' }] }).some((e) => /defaults/.test(e))).toBe(true);
  });
});

describe('BATCH_MANIFEST_SCHEMA stays in sync with the validator', () => {
  it('requires jobs at the top level and id on each job', () => {
    expect(BATCH_MANIFEST_SCHEMA.required).toContain('jobs');
    expect(BATCH_MANIFEST_SCHEMA.properties.jobs.items.required).toContain('id');
    expect(BATCH_MANIFEST_SCHEMA.properties.jobs.minItems).toBe(1);
  });

  it('allows extra params on jobs (additionalProperties) — they ride into the generation context', () => {
    expect(BATCH_MANIFEST_SCHEMA.properties.jobs.items.additionalProperties).toBe(true);
  });
});

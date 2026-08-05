/**
 * JSON Schema for the batch manifest + a lightweight structural validator.
 *
 * The schema is the published artifact: `gen-ai batch schema` prints it so
 * authors can save it and reference it via `"$schema"` for editor autocomplete
 * and validation. `validateManifestStructure` is a dependency-free runtime
 * check covering the invariants that matter most (so a malformed manifest fails
 * with a clear message rather than a confusing downstream error). It is kept in
 * sync with the schema by `manifest-schema.test.ts`.
 */

/** JSON Schema (draft-07) describing a `gen-ai batch run` manifest file. */
export const BATCH_MANIFEST_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://picsart.com/gen-ai/batch-manifest.schema.json',
  title: 'gen-ai batch manifest',
  description: 'Manifest consumed by `gen-ai batch run <file>`.',
  type: 'object',
  required: ['jobs'],
  additionalProperties: false,
  properties: {
    defaults: {
      type: 'object',
      description: 'Generation params merged into every job unless the job overrides them (e.g. model, aspectRatio).',
      additionalProperties: true,
    },
    jobs: {
      type: 'array',
      minItems: 1,
      description: 'One entry per generation.',
      items: {
        type: 'object',
        required: ['id'],
        additionalProperties: true,
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            description: 'Unique identifier; also names the downloaded output file.',
          },
          model: {
            type: 'string',
            description: 'Model id. Optional when `defaults.model` is set.',
          },
          prompt: { type: 'string', description: 'Text prompt for this job.' },
        },
      },
    },
  },
} as const;

/**
 * Structural validation that mirrors the schema's load-bearing rules. Returns a
 * list of human-readable problems (empty = valid). Does NOT check model
 * existence — the caller does that with `findModel` after defaults are applied.
 */
export function validateManifestStructure(data: unknown): string[] {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return ['Manifest must be a JSON object with a "jobs" array.'];
  }

  const manifest = data as Record<string, unknown>;

  if (
    manifest.defaults !== undefined &&
    (typeof manifest.defaults !== 'object' || manifest.defaults === null || Array.isArray(manifest.defaults))
  ) {
    errors.push('"defaults" must be an object.');
  }

  const jobs = manifest.jobs;
  if (!Array.isArray(jobs)) {
    errors.push('"jobs" must be an array.');
    return errors;
  }
  if (jobs.length === 0) {
    errors.push('"jobs" must contain at least one job.');
    return errors;
  }

  const seenIds = new Set<string>();
  jobs.forEach((job, index) => {
    if (typeof job !== 'object' || job === null || Array.isArray(job)) {
      errors.push(`jobs[${index}] must be an object.`);
      return;
    }
    const j = job as Record<string, unknown>;
    if (typeof j.id !== 'string' || j.id.trim().length === 0) {
      errors.push(`jobs[${index}] is missing a non-empty string "id".`);
    } else if (seenIds.has(j.id)) {
      errors.push(`Duplicate job id "${j.id}" — ids must be unique.`);
    } else {
      seenIds.add(j.id);
    }
    if (j.model !== undefined && typeof j.model !== 'string') {
      errors.push(`jobs[${index}] ("${typeof j.id === 'string' ? j.id : index}") has a non-string "model".`);
    }
  });

  return errors;
}

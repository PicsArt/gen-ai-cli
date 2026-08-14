/**
 * Minimal model fixtures for Blocks 3-7 tests.
 *
 * Each fixture is the smallest valid object that Block 3 (Catalog) reads:
 * an `id` and a `paramConfig` declaring one or more descriptors. The
 * full `ModelDefinition` shape is not needed — `loadCatalog` only consumes
 * `Pick<ModelDefinition, 'id' | 'paramConfig'>`.
 *
 * Coverage:
 *   - one fixture per descriptor kind (enum<string>, enum<number>,
 *     boolean, range, text, catalog, file, object)
 *   - dedup scenarios: two models sharing one key with the same kind
 *   - conflict scenarios: two models sharing one key with different kinds
 */
import type { ModelLike } from '../02-catalog/index.ts';

export type { ModelLike };

/* ── One per descriptor kind ──────────────────────────────────────────── */

export const MODEL_ENUM_STRING: ModelLike = {
  id: 'fx-enum-string',
  paramConfig: {
    aspectRatio: {
      label: 'Aspect Ratio',
      required: true,
      descriptor: {
        kind: 'enum',
        valueType: 'string',
        options: [{ id: '16:9' }, { id: '9:16' }],
        default: '16:9',
      },
    },
  },
};

export const MODEL_ENUM_NUMBER: ModelLike = {
  id: 'fx-enum-number',
  paramConfig: {
    duration: {
      label: 'Duration',
      descriptor: {
        kind: 'enum',
        valueType: 'number',
        options: [{ id: 5 }, { id: 10 }, { id: 15 }],
        default: 5,
      },
    },
  },
};

export const MODEL_BOOLEAN: ModelLike = {
  id: 'fx-boolean',
  paramConfig: {
    generateAudio: {
      label: 'Generate audio',
      descriptor: { kind: 'boolean', default: true },
    },
  },
};

export const MODEL_RANGE: ModelLike = {
  id: 'fx-range',
  paramConfig: {
    cfgScale: {
      label: 'CFG scale',
      descriptor: { kind: 'range', min: 1, max: 20, default: 7.5 },
    },
  },
};

export const MODEL_TEXT: ModelLike = {
  id: 'fx-text',
  paramConfig: {
    prompt: {
      label: 'Prompt',
      required: true,
      descriptor: { kind: 'text', maxLength: 2000 },
    },
  },
};

export const MODEL_CATALOG: ModelLike = {
  id: 'fx-catalog',
  paramConfig: {
    voiceId: {
      label: 'Voice',
      required: true,
      descriptor: {
        kind: 'catalog',
        source: { workflow: 'heygen/v1/catalog/voices' },
        default: 'vx_default',
      },
    },
  },
};

export const MODEL_FILE: ModelLike = {
  id: 'fx-file',
  paramConfig: {
    imageUrls: {
      label: 'Source Images',
      descriptor: { kind: 'file', accept: 'image', array: { max: 4 } },
    },
  },
};

export const MODEL_OBJECT: ModelLike = {
  id: 'fx-object',
  paramConfig: {
    multiPrompt: {
      label: 'Multi-shot prompts',
      descriptor: {
        kind: 'object',
        array: { max: 6 },
        fields: {
          index: { kind: 'range', min: 0, max: 5, default: 0 },
          prompt: { kind: 'text', maxLength: 512 },
          duration: { kind: 'text' },
        },
      },
    },
  },
};

/* ── Dedup scenarios — same key + same kind across two models ─────────── */

export const MODEL_DEDUP_A: ModelLike = {
  id: 'fx-dedup-a',
  paramConfig: {
    aspectRatio: {
      descriptor: {
        kind: 'enum',
        valueType: 'string',
        options: [{ id: '16:9' }, { id: '9:16' }],
        default: '16:9',
      },
    },
  },
};

export const MODEL_DEDUP_B: ModelLike = {
  id: 'fx-dedup-b',
  paramConfig: {
    aspectRatio: {
      descriptor: {
        kind: 'enum',
        valueType: 'string',
        options: [{ id: '16:9' }, { id: '1:1' }, { id: '21:9' }],
        default: '16:9',
      },
    },
  },
};

/* ── Conflict scenarios — same key + different kinds ──────────────────── */

export const MODEL_CONFLICT_TEXT: ModelLike = {
  id: 'fx-conflict-text',
  paramConfig: {
    overlap: { descriptor: { kind: 'text' } },
  },
};

export const MODEL_CONFLICT_RANGE: ModelLike = {
  id: 'fx-conflict-range',
  paramConfig: {
    overlap: { descriptor: { kind: 'range', min: 0, max: 1, default: 0.5 } },
  },
};

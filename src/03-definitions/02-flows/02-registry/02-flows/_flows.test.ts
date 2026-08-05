/**
 * Registry-level contract tests for every declared flow.
 *
 * Each individual flow folder can carry its own deeper tests (see
 * `01-video/video.test.ts` for the exemplar). This file exists to:
 *   1. Lock the registry shape — every entry's key matches its spec id.
 *   2. Smoke-test the modelFilter discipline (uses the SDK's InputType
 *      union, respects `disabled`, rejects every non-matching type).
 *   3. Verify required-input declarations are plausible (no empty for
 *      generation flows, at least one of prompt/image/video/audio).
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { FLOWS, type FlowId } from './_flows.ts';

const ALL_INPUT_TYPES: ModelDefinition['inputType'][] = [
  't2v',
  'i2v',
  'v2v',
  'a2v',
  't2i',
  'i2i',
  't2a',
  'v2a',
  'tts',
  'sts',
  'sfx',
  'music',
];

function mockModel(overrides: Partial<ModelDefinition>): ModelDefinition {
  return {
    id: 'mock',
    name: 'Mock',
    inputType: 't2i',
    mode: 'image',
    disabled: false,
    paramConfig: {},
    provider: 'picsart' as ModelDefinition['provider'],
    workflow: 'mock',
    providerName: 'Mock',
    providerColor: '#000',
    providerLabel: 'M',
    description: '',
    features: [],
    ...overrides,
  } as ModelDefinition;
}

/**
 * InputType-only flows: a model with the named InputType should pass
 * the filter directly. Used to drive the simple table-style tests.
 */
const INPUT_TYPE_ONLY_FLOWS: Record<string, ModelDefinition['inputType']> = {
  video: 't2v',
  image: 't2i',
  'image-to-video': 'i2v',
  'video-edit': 'v2v',
  'talking-photo': 'a2v',
  'text-to-speech': 'tts',
  'voice-clone': 'sts',
  music: 'music',
  sfx: 'sfx',
  'video-audio': 'v2a',
  'audio-from-text': 't2a',
};

/**
 * Sub-category flows: an InputType is necessary but not sufficient —
 * a representative `toolId` makes the predicate accept. Each row pairs
 * an InputType with a fixture toolId known to satisfy the predicate.
 */
const SUB_CATEGORY_FLOWS: Record<string, { inputType: ModelDefinition['inputType']; toolId: string }> = {
  'remove-bg': { inputType: 'i2i', toolId: 'image-to-image.picsart-sod' },
  'change-bg': { inputType: 'i2i', toolId: 'image-to-image.picsart-change-bg' },
  enhance: { inputType: 'i2i', toolId: 'image-to-image.picsart-enhance' },
  upscale: { inputType: 'i2i', toolId: 'image-gen.recraft.creative-upscale' },
  vectorize: { inputType: 'i2i', toolId: 'image-gen.recraft.vectorize' },
  'edit-image': { inputType: 'i2i', toolId: 'image-to-image.qwen-image-edit' },
  character: { inputType: 'i2i', toolId: 'image-gen.runway-gen4-ref' },
  // `multi-image` is descriptor-driven (paramConfig.imageUrls.array.max > 1),
  // not toolId-driven — covered by its own test below.
  extend: { inputType: 'v2v', toolId: 'video-gen.sora-2-extend' },
};

/* ─────────────────────────────────────────────────────────────────────── */
/*  Registry shape                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('FLOWS — registry shape', () => {
  it('every registry key matches the flow spec id', () => {
    for (const [key, spec] of Object.entries(FLOWS)) {
      expect(spec.id).toBe(key);
    }
  });

  it('every spec has a non-empty description', () => {
    for (const spec of Object.values(FLOWS)) {
      expect(spec.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('every spec declares at least one static flag group (universal is expected)', () => {
    for (const spec of Object.values(FLOWS)) {
      expect(spec.staticFlagGroups.length).toBeGreaterThan(0);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  modelFilter discipline                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('FLOWS — modelFilter (InputType-only flows)', () => {
  for (const [id, expectedType] of Object.entries(INPUT_TYPE_ONLY_FLOWS)) {
    describe(`flow "${id}" — inputType=${expectedType}`, () => {
      const flow = FLOWS[id as FlowId];

      it('accepts a model with the expected InputType', () => {
        expect(flow.modelFilter(mockModel({ inputType: expectedType }))).toBe(true);
      });

      it('rejects every other InputType', () => {
        for (const other of ALL_INPUT_TYPES) {
          if (other === expectedType) continue;
          expect(flow.modelFilter(mockModel({ inputType: other }))).toBe(false);
        }
      });

      it('rejects disabled models even when InputType matches', () => {
        expect(flow.modelFilter(mockModel({ inputType: expectedType, disabled: true }))).toBe(false);
      });
    });
  }
});

describe('FLOWS — modelFilter (sub-category flows with toolId discriminator)', () => {
  for (const [id, { inputType, toolId }] of Object.entries(SUB_CATEGORY_FLOWS)) {
    describe(`flow "${id}" — inputType=${inputType} + toolId pattern`, () => {
      const flow = FLOWS[id as FlowId];

      it('accepts a model with matching inputType AND a representative toolId', () => {
        expect(flow.modelFilter(mockModel({ inputType, toolId }))).toBe(true);
      });

      it('rejects models with the right InputType but an unrelated toolId', () => {
        expect(flow.modelFilter(mockModel({ inputType, toolId: 'something.unrelated' }))).toBe(false);
      });

      it('rejects models with the matching toolId but the wrong InputType', () => {
        const otherType = ALL_INPUT_TYPES.find((t) => t !== inputType) as ModelDefinition['inputType'];
        expect(flow.modelFilter(mockModel({ inputType: otherType, toolId }))).toBe(false);
      });

      it('rejects disabled models even when both inputType and toolId match', () => {
        expect(flow.modelFilter(mockModel({ inputType, toolId, disabled: true }))).toBe(false);
      });
    });
  }
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Descriptor-driven flows                                               */
/* ─────────────────────────────────────────────────────────────────────── */

describe('FLOWS — descriptor-driven (paramConfig-shape discriminator)', () => {
  describe('flow "multi-image" — `paramConfig.imageUrls.array.max > 1`', () => {
    const flow = FLOWS['multi-image'];

    function modelWithImageMax(max: number, inputType: ModelDefinition['inputType'] = 't2i'): ModelDefinition {
      return mockModel({
        inputType,
        paramConfig: {
          imageUrls: { descriptor: { kind: 'file', accept: 'image', array: { max } } },
        } as unknown as ModelDefinition['paramConfig'],
      });
    }

    it('accepts a model whose imageUrls descriptor declares array.max > 1', () => {
      expect(flow.modelFilter(modelWithImageMax(4))).toBe(true);
    });

    it('rejects a model whose imageUrls descriptor declares array.max === 1', () => {
      expect(flow.modelFilter(modelWithImageMax(1))).toBe(false);
    });

    it('rejects a model with no imageUrls descriptor at all', () => {
      expect(flow.modelFilter(mockModel({ paramConfig: {} }))).toBe(false);
    });

    it('rejects disabled models even when imageUrls declares array.max > 1', () => {
      expect(flow.modelFilter({ ...modelWithImageMax(4), disabled: true } as ModelDefinition)).toBe(false);
    });

    it('accepts across InputTypes (t2i / i2i / i2v / v2v) — descriptor decides, not inputType', () => {
      for (const t of ['t2i', 'i2i', 'i2v', 'v2v'] as const) {
        expect(flow.modelFilter(modelWithImageMax(3, t))).toBe(true);
      }
    });
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  requiredInputs sanity                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

describe('FLOWS — requiredInputs', () => {
  // The universal `generate` flow has no flow-level required inputs: the
  // chosen model's paramConfig decides what the user must supply at
  // runtime. `describe` is exempt for a different reason — its requirement
  // is "image OR video", which the flat AND-list can't express, so the
  // resolver's text-analysis finalize step enforces media presence instead.
  // Every other flow narrows to a category and can declare required inputs
  // statically.
  const UNIVERSAL: FlowId[] = ['generate', 'describe'];

  it('every specialized flow requires at least one user input', () => {
    for (const [id, spec] of Object.entries(FLOWS)) {
      if (UNIVERSAL.includes(id as FlowId)) continue;
      expect(spec.requiredInputs.length).toBeGreaterThan(0);
    }
  });

  it('every required input is one of the canonical RequiredInput values', () => {
    const valid = new Set(['prompt', 'image', 'video', 'audio']);
    for (const spec of Object.values(FLOWS)) {
      for (const input of spec.requiredInputs) expect(valid.has(input)).toBe(true);
    }
  });
});

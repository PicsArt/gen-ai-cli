/**
 * Spec for resolver helpers.
 *
 * Contract:
 *   resolveModelFromFlag(modelFlag, config):
 *     - returns undefined when no flag is passed
 *     - returns undefined when the SDK can't find the model
 *     - returns undefined when the model fails the operationConfig filter
 *     - returns the model otherwise
 *
 *   getModelsForOperation(config):
 *     - returns only models matching the filter
 *     - excludes disabled models
 *
 *   validateRequiredInputs(config, inputs):
 *     - emits a FieldError per missing required input
 *     - 'prompt'/'text' checks inputs.prompt
 *     - 'image' checks inputs.files.images
 *     - 'video' checks inputs.files.video
 *     - 'audio' checks inputs.files.audio
 *     - optional inputs (ending in '?') are skipped
 *
 *   buildParamsFromFlags(flags):
 *     - delegates to the Param Surface catalog (no hand-maintained map)
 *     - maps kebab-case flag names → camelCase ctx keys
 *     - reassembles object descriptors from per-subfield flags
 *     - skips null/undefined flag values
 *     - falls back to SDK_GAP_FLAGS for fields without a descriptor
 *     - silently ignores flags outside the catalog + gap list
 */
import { ALL_MODELS, getModel, Models } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { defineFlow, type FlowSpec } from '#flows';
import { UsageError } from '#infra/errors/usage.ts';
import {
  buildParamsFromFlags,
  getModelsForOperation,
  resolveModelFromFlag,
  validateFileSlotLimits,
  validateRequiredInputs,
} from './types.ts';

const ACCEPT_ALL: FlowSpec = defineFlow({
  id: 'test',
  description: 'test',
  staticFlagGroups: [],
  staticStepGroups: [],
  modelFilter: () => true,
  requiredInputs: [],
});

const ACCEPT_NONE: FlowSpec = defineFlow({ ...ACCEPT_ALL, modelFilter: () => false });

/* ─────────────────────────────────────────────────────────────────────── */
/*  resolveModelFromFlag                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('resolveModelFromFlag', () => {
  it('returns undefined when no flag is passed', () => {
    expect(resolveModelFromFlag(undefined, ACCEPT_ALL)).toBeUndefined();
    expect(resolveModelFromFlag('', ACCEPT_ALL)).toBeUndefined();
  });

  it('returns undefined for an unknown model id', () => {
    expect(resolveModelFromFlag('totally-fake-model-zzz', ACCEPT_ALL)).toBeUndefined();
  });

  it('returns undefined when the model is filtered out by operationConfig', () => {
    // Pick any real model and reject it via filter
    const real = getModelsForOperation(ACCEPT_ALL)[0];
    expect(real).toBeDefined();
    expect(resolveModelFromFlag(real.id, ACCEPT_NONE)).toBeUndefined();
  });

  it('returns the model when found AND filter accepts', () => {
    const real = getModelsForOperation(ACCEPT_ALL)[0];
    const result = resolveModelFromFlag(real.id, ACCEPT_ALL);
    expect(result?.id).toBe(real.id);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  getModelsForOperation                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

describe('getModelsForOperation', () => {
  it('returns only models that pass the filter', () => {
    const t2i = getModelsForOperation({ ...ACCEPT_ALL, modelFilter: (m) => m.inputType === 't2i' });
    expect(t2i.length).toBeGreaterThan(0);
    expect(t2i.every((m) => m.inputType === 't2i')).toBe(true);
  });

  it('excludes disabled models', () => {
    const all = getModelsForOperation(ACCEPT_ALL);
    expect(all.every((m) => m.disabled !== true)).toBe(true);
  });

  it('returns empty when nothing passes the filter', () => {
    expect(getModelsForOperation(ACCEPT_NONE)).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  validateRequiredInputs                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('validateRequiredInputs', () => {
  it('returns [] when no inputs are required', () => {
    expect(validateRequiredInputs(ACCEPT_ALL, {})).toEqual([]);
  });

  it('reports a missing prompt', () => {
    const errs = validateRequiredInputs({ ...ACCEPT_ALL, requiredInputs: ['prompt'] }, {});
    expect(errs.length).toBe(1);
    expect(errs[0].field).toContain('--prompt');
  });

  it('accepts a non-empty prompt', () => {
    const errs = validateRequiredInputs({ ...ACCEPT_ALL, requiredInputs: ['prompt'] }, { params: { prompt: 'hi' } });
    expect(errs).toEqual([]);
  });

  it('treats whitespace-only prompt as missing', () => {
    const errs = validateRequiredInputs({ ...ACCEPT_ALL, requiredInputs: ['prompt'] }, { params: { prompt: '   ' } });
    expect(errs.length).toBe(1);
  });

  it('reports missing image / video / audio', () => {
    const errs = validateRequiredInputs({ ...ACCEPT_ALL, requiredInputs: ['image', 'video', 'audio'] }, {});
    expect(errs.map((e) => e.field).sort()).toEqual([
      '--audio or --audio-urls',
      '--image (-i) or --start-frame',
      '--video or --video-urls',
    ]);
  });

  it('accepts files when present', () => {
    const errs = validateRequiredInputs(
      { ...ACCEPT_ALL, requiredInputs: ['image', 'video', 'audio'] },
      { files: { images: ['a.png'], video: 'b.mp4', audio: 'c.mp3' } },
    );
    expect(errs).toEqual([]);
  });

  // Models like seedance-2.0-video-extend take their video via the array
  // slot (`videoUrls` → files.videos); seed-audio models likewise take
  // audio via `audioUrls` → files.audios. Either slot satisfies the
  // flow-level requirement — mirroring how startFrame satisfies 'image'.
  it("counts files.videos toward the 'video' requirement", () => {
    const errs = validateRequiredInputs(
      { ...ACCEPT_ALL, requiredInputs: ['video'] },
      { files: { videos: ['clip.mp4'] } },
    );
    expect(errs).toEqual([]);
  });

  it("counts files.audios toward the 'audio' requirement", () => {
    const errs = validateRequiredInputs(
      { ...ACCEPT_ALL, requiredInputs: ['audio'] },
      { files: { audios: ['track.mp3'] } },
    );
    expect(errs).toEqual([]);
  });

  it("does not count an empty files.videos array toward the 'video' requirement", () => {
    const errs = validateRequiredInputs({ ...ACCEPT_ALL, requiredInputs: ['video'] }, { files: { videos: [] } });
    expect(errs.length).toBe(1);
  });

  // Note: optional-input ("prompt?") suffix support was dropped along with
  // OperationConfig. FlowSpec.requiredInputs is strictly typed and the
  // resolver treats every entry as required. Optional inputs aren't
  // expressible — flows that want optional behavior just leave the entry off.

  it('aggregates errors for multiple missing inputs', () => {
    const errs = validateRequiredInputs({ ...ACCEPT_ALL, requiredInputs: ['prompt', 'image'] }, {});
    expect(errs.length).toBe(2);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  buildParamsFromFlags                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('buildParamsFromFlags', () => {
  it('returns an empty object when no flags are set', () => {
    expect(buildParamsFromFlags({})).toEqual({});
  });

  it('maps kebab-case flag names to camelCase ctx keys via the catalog', () => {
    const out = buildParamsFromFlags({
      'aspect-ratio': '16:9',
      'cfg-scale': '0.5', // cfgScale descriptor is range [0, 1] for kling
      'generate-audio': true,
      'negative-prompt': 'no birds',
    });
    expect(out).toMatchObject({
      aspectRatio: '16:9',
      cfgScale: 0.5,
      generateAudio: true,
      negativePrompt: 'no birds',
    });
  });

  it('skips null and undefined flag values', () => {
    const out = buildParamsFromFlags({
      duration: 5,
      resolution: undefined,
      seed: null as unknown as number,
    });
    expect(out.duration).toBe(5);
    expect(out.resolution).toBeUndefined();
    expect(out.seed).toBeUndefined();
  });

  it('reassembles object descriptors from per-subfield flags', () => {
    // multiPrompt is a multi-field object descriptor (kling V3). The
    // composer emits one `--multi-prompt-<sub>` flag per subfield; the
    // reader pairs the per-subfield arrays by position.
    const out = buildParamsFromFlags({
      'multi-prompt-prompt': ['wide shot', 'close-up'],
      'multi-prompt-duration': ['5', '7'],
    });
    expect(Array.isArray(out.multiPrompt)).toBe(true);
    const arr = out.multiPrompt as Array<{ prompt?: string; duration?: string }>;
    expect(arr).toHaveLength(2);
    expect(arr[0]?.prompt).toBe('wide shot');
    expect(arr[1]?.prompt).toBe('close-up');
  });

  it('covers SDK gap flags (no descriptor) via the static gap overlay', () => {
    const out = buildParamsFromFlags({
      'external-task-id': 'task-xyz',
      'sound-effect-prompt': 'crackling fire',
      'bgm-prompt': 'cinematic strings',
      'asmr-mode': true,
    });
    expect(out).toMatchObject({
      externalTaskId: 'task-xyz',
      soundEffectPrompt: 'crackling fire',
      bgmPrompt: 'cinematic strings',
      asmrMode: true,
    });
  });

  it('silently ignores flags that are neither catalog descriptors nor gap entries', () => {
    expect(buildParamsFromFlags({ totallyMadeUp: 'x', json: true, quiet: true })).toEqual({});
  });

  it('does NOT carry universal/output flags through to the SDK ctx', () => {
    // --json, --quiet, --download, --save-to-drive are CLI concerns, not SDK
    const out = buildParamsFromFlags({
      'aspect-ratio': '16:9',
      json: true,
      download: './out',
      'save-to-drive': true,
    });
    expect(out.aspectRatio).toBe('16:9');
    expect(out).not.toHaveProperty('json');
    expect(out).not.toHaveProperty('download');
    expect(out).not.toHaveProperty('save-to-drive');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  validateFileSlotLimits                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('validateFileSlotLimits', () => {
  // Anchor to a real catalog model with a small imageUrls cap so the test
  // survives catalog changes (the cap is read from the catalog, not hardcoded).
  const capped = ALL_MODELS.map((m) => ({ m, cap: Models.getFileParam(m.id, 'imageUrls')?.max })).find(
    (x) => typeof x.cap === 'number' && x.cap >= 1 && x.cap <= 6,
  );

  it('throws a UsageError when the image count exceeds the model cap', () => {
    if (!capped) return; // no suitable fixture in this catalog build
    const { m, cap } = capped;
    const tooMany = Array.from({ length: (cap as number) + 1 }, (_, i) => `https://x/${i}.png`);
    expect(() => validateFileSlotLimits(getModel(m.id)!, { images: tooMany })).toThrow(UsageError);
  });

  it('accepts exactly the cap', () => {
    if (!capped) return;
    const { m, cap } = capped;
    const exact = Array.from({ length: cap as number }, (_, i) => `https://x/${i}.png`);
    expect(() => validateFileSlotLimits(getModel(m.id)!, { images: exact })).not.toThrow();
  });

  it('is a no-op for empty / absent slots', () => {
    if (!capped) return;
    expect(() => validateFileSlotLimits(getModel(capped.m.id)!, {})).not.toThrow();
    expect(() => validateFileSlotLimits(getModel(capped.m.id)!, { images: [] })).not.toThrow();
  });
});

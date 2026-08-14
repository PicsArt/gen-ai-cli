/**
 * Spec for scripted resolver.
 *
 * Contract:
 *   resolveScripted(config, flags, deps):
 *     - throws UsageError when --model is missing
 *     - throws UsageError when --model is not found in SDK
 *     - throws UsageError when model fails operationConfig.modelFilter
 *     - threads --image / --video / --audio into files
 *     - threads --start-frame / --end-frame into files
 *     - threads --video-urls / --audio-urls arrays into files.videos / files.audios
 *     - threads --prompt into the returned prompt field
 *     - builds params from the rest of the flags (via buildParamsFromFlags)
 *     - throws ValidationError when required inputs are missing
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { Models } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import type { FlowSpec } from '#flows';
import { UsageError } from '#infra/errors/usage.ts';
import { ValidationError } from '#infra/errors/validation.ts';
import type { CliDeps } from '#root/deps.ts';
import { resolveScripted } from './resolver.ts';

const ACCEPT_ALL: FlowSpec = {
  id: 'test',
  description: 'test',
  staticFlagGroups: [],
  staticStepGroups: [],
  modelFilter: () => true,
  requiredInputs: [],
};

const deps = { flags: {} } as CliDeps;

function someModel(): ModelDefinition {
  // Pick a model that exposes `imageUrls` so the scripted resolver's `-i`
  // auto-routing leaves it in `files.images` (rather than rerouting to
  // `startFrame` for models that only have a start frame).
  return Models.list().find((m) => !m.disabled && !!Models.getFileParam(m.id, 'imageUrls')) as ModelDefinition;
}

function startFrameOnlyModel(): ModelDefinition | undefined {
  return Models.list().find(
    (m) => !m.disabled && !Models.getFileParam(m.id, 'imageUrls') && !!Models.getFileParam(m.id, 'startFrame'),
  );
}

function videoUrlsOnlyModel(): ModelDefinition | undefined {
  // e.g. seedance-2.0-video-extend — declares `videoUrls`, no `videoUrl`
  return Models.list().find(
    (m) => !m.disabled && !Models.getFileParam(m.id, 'videoUrl') && !!Models.getFileParam(m.id, 'videoUrls'),
  );
}

function audioUrlsOnlyModel(): ModelDefinition | undefined {
  // e.g. seed-audio-1.0 — declares `audioUrls`, no `audioUrl`
  return Models.list().find(
    (m) => !m.disabled && !Models.getFileParam(m.id, 'audioUrl') && !!Models.getFileParam(m.id, 'audioUrls'),
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Model errors                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('resolveScripted — model resolution', () => {
  it('throws UsageError when --model is missing', async () => {
    await expect(resolveScripted(ACCEPT_ALL, {}, deps)).rejects.toThrow(UsageError);
  });

  it('throws UsageError when --model is unknown', async () => {
    await expect(resolveScripted(ACCEPT_ALL, { model: 'no-such-model-zzz' }, deps)).rejects.toThrow(UsageError);
  });

  it('throws UsageError when model fails the operation filter', async () => {
    const m = someModel();
    await expect(resolveScripted({ ...ACCEPT_ALL, modelFilter: () => false }, { model: m.id }, deps)).rejects.toThrow(
      /is not supported by/,
    );
  });

  it('returns the resolved model', async () => {
    const m = someModel();
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id }, deps);
    expect(out.model.id).toBe(m.id);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Input threading                                                       */
/* ─────────────────────────────────────────────────────────────────────── */

describe('resolveScripted — file inputs', () => {
  it('threads --image array into files.images', async () => {
    const m = someModel();
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id, image: ['a.png', 'b.png'] }, deps);
    expect(out.files.images).toEqual(['a.png', 'b.png']);
  });

  it('threads --video / --audio / --start-frame / --end-frame', async () => {
    const m = someModel();
    const out = await resolveScripted(
      ACCEPT_ALL,
      {
        model: m.id,
        video: 'v.mp4',
        audio: 'a.mp3',
        'start-frame': 'start.png',
        'end-frame': 'end.png',
      },
      deps,
    );
    expect(out.files.video).toBe('v.mp4');
    expect(out.files.audio).toBe('a.mp3');
    expect(out.files.startFrame).toBe('start.png');
    expect(out.files.endFrame).toBe('end.png');
  });

  it('routes `-i` into files.startFrame when the model exposes startFrame (no imageUrls)', async () => {
    const m = startFrameOnlyModel();
    if (!m) return; // SDK has no such model right now — skip
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id, image: ['shot.png'] }, deps);
    expect(out.files.startFrame).toBe('shot.png');
    expect(out.files.images).toBeUndefined();
  });

  it('threads --prompt into the returned prompt', async () => {
    const m = someModel();
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id, prompt: 'a sunset' }, deps);
    expect(out.params.prompt as string | undefined).toBe('a sunset');
  });

  it('returns empty files when no file flags are set', async () => {
    const m = someModel();
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id }, deps);
    expect(out.files).toEqual({});
  });

  // Regression: the SDK rename of reference-* descriptors to consolidated
  // `videoUrls` / `audioUrls` (commit 8844f221, May 14) dropped the
  // resolver-side wiring on the assumption Param Surface would auto-derive
  // it. Param Surface only auto-derives the flag declaration (so the flag
  // shows up in --help); the flag-reader explicitly skips file-kind
  // descriptors. Without explicit wiring here, models like
  // `seedance-2.0-video-extend` reject every call with "videoUrls is
  // required" because the value never reaches the generation context.
  it('threads --video-urls array into files.videos (regression: seedance-2.0-video-extend)', async () => {
    const m = someModel();
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id, 'video-urls': ['clip-a.mp4', 'clip-b.mp4'] }, deps);
    expect(out.files.videos).toEqual(['clip-a.mp4', 'clip-b.mp4']);
  });

  it('threads --audio-urls array into files.audios', async () => {
    const m = someModel();
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id, 'audio-urls': ['track-a.mp3', 'track-b.mp3'] }, deps);
    expect(out.files.audios).toEqual(['track-a.mp3', 'track-b.mp3']);
  });

  it('rejects --video-urls entries that are empty strings (clear local error)', async () => {
    const m = someModel();
    await expect(resolveScripted(ACCEPT_ALL, { model: m.id, 'video-urls': ['ok.mp4', ''] }, deps)).rejects.toThrow(
      UsageError,
    );
  });

  it('leaves files.videos / files.audios unset when those flags are absent', async () => {
    const m = someModel();
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id }, deps);
    expect(out.files.videos).toBeUndefined();
    expect(out.files.audios).toBeUndefined();
  });

  // `--video` ergonomics mirror the `-i` → startFrame bridge: models like
  // seedance-2.0-video-extend expose `videoUrls` (array) instead of
  // `videoUrl`. When the model has only `videoUrls` and the user passed
  // `--video`, route the value into files.videos so the single CLI surface
  // covers both shapes — otherwise the value lands on a ctx key the model
  // doesn't declare and the API rejects with a 400.
  it('routes --video into files.videos when the model exposes only videoUrls', async () => {
    const m = videoUrlsOnlyModel();
    if (!m) return; // SDK has no such model right now — skip
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id, video: 'clip.mp4' }, deps);
    expect(out.files.videos).toEqual(['clip.mp4']);
    expect(out.files.video).toBeUndefined();
  });

  it('keeps --video on files.video when the model has no videoUrls slot', async () => {
    const m = someModel();
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id, video: 'clip.mp4' }, deps);
    expect(out.files.video).toBe('clip.mp4');
    expect(out.files.videos).toBeUndefined();
  });

  it('routes --audio into files.audios when the model exposes only audioUrls', async () => {
    const m = audioUrlsOnlyModel();
    if (!m) return; // SDK has no such model right now — skip
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id, audio: 'track.mp3' }, deps);
    expect(out.files.audios).toEqual(['track.mp3']);
    expect(out.files.audio).toBeUndefined();
  });

  it('satisfies a required video input via --video-urls (regression: extend flow)', async () => {
    const m = videoUrlsOnlyModel();
    if (!m) return; // SDK has no such model right now — skip
    const out = await resolveScripted(
      { ...ACCEPT_ALL, requiredInputs: ['video'] },
      { model: m.id, 'video-urls': ['clip.mp4'] },
      deps,
    );
    expect(out.files.videos).toEqual(['clip.mp4']);
  });

  it('satisfies a required audio input via --audio-urls', async () => {
    const m = audioUrlsOnlyModel();
    if (!m) return; // SDK has no such model right now — skip
    const out = await resolveScripted(
      { ...ACCEPT_ALL, requiredInputs: ['audio'] },
      { model: m.id, 'audio-urls': ['track.mp3'] },
      deps,
    );
    expect(out.files.audios).toEqual(['track.mp3']);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Params + validation                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

describe('resolveScripted — params', () => {
  it('routes non-input flags through buildParamsFromFlags', async () => {
    const m = someModel();
    const out = await resolveScripted(ACCEPT_ALL, { model: m.id, 'aspect-ratio': '16:9', duration: 5 }, deps);
    expect(out.params.aspectRatio).toBe('16:9');
    expect(out.params.duration).toBe(5);
  });
});

describe('resolveScripted — required input validation', () => {
  it('throws ValidationError when a required input is missing', async () => {
    const m = someModel();
    await expect(resolveScripted({ ...ACCEPT_ALL, requiredInputs: ['prompt'] }, { model: m.id }, deps)).rejects.toThrow(
      ValidationError,
    );
  });

  it('accepts when required input is provided', async () => {
    const m = someModel();
    await expect(
      resolveScripted({ ...ACCEPT_ALL, requiredInputs: ['prompt'] }, { model: m.id, prompt: 'hi' }, deps),
    ).resolves.toBeDefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Vendor cross-field invariants                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('resolveScripted — Kling multi-shot pre-flight', () => {
  const kling = Models.list().find((m) => m.id === 'kling-v3') as ModelDefinition;

  it('rejects --multi-shot without --shot-type', async () => {
    await expect(
      resolveScripted(
        ACCEPT_ALL,
        { model: kling.id, prompt: 'p', 'multi-shot': true } as Record<string, unknown>,
        deps,
      ),
    ).rejects.toThrow(/shot-type is required/);
  });

  it('rejects shot durations that do not sum to --duration', async () => {
    await expect(
      resolveScripted(
        ACCEPT_ALL,
        {
          model: kling.id,
          prompt: 'p',
          'multi-shot': true,
          'shot-type': 'customize',
          duration: 10,
          'multi-prompt-prompt': ['a', 'b'],
          'multi-prompt-duration': ['3', '4'],
        } as Record<string, unknown>,
        deps,
      ),
    ).rejects.toThrow(/sum to 7s but --duration is 10s/);
  });

  it('accepts when shot durations sum matches --duration', async () => {
    const out = await resolveScripted(
      ACCEPT_ALL,
      {
        model: kling.id,
        'multi-shot': true,
        'shot-type': 'customize',
        duration: 10,
        'multi-prompt-prompt': ['a', 'b'],
        'multi-prompt-duration': ['6', '4'],
      } as Record<string, unknown>,
      deps,
    );
    expect(out.params.multiShot).toBe(true);
    expect(out.params.shotType).toBe('customize');
  });

  it('auto-numbers multiPrompt indices 1..N when the caller does not set them', async () => {
    const out = await resolveScripted(
      ACCEPT_ALL,
      {
        model: kling.id,
        'multi-shot': true,
        'shot-type': 'customize',
        duration: 12,
        'multi-prompt-prompt': ['a', 'b', 'c'],
        'multi-prompt-duration': ['3', '5', '4'],
      } as Record<string, unknown>,
      deps,
    );
    const shots = out.params.multiPrompt as { index: number }[];
    expect(shots.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('preserves caller-supplied multiPrompt indices', async () => {
    const out = await resolveScripted(
      ACCEPT_ALL,
      {
        model: kling.id,
        'multi-shot': true,
        'shot-type': 'customize',
        duration: 12,
        'multi-prompt-prompt': ['a', 'b'],
        'multi-prompt-duration': ['8', '4'],
        'multi-prompt-index': ['2', '4'],
      } as Record<string, unknown>,
      deps,
    );
    const shots = out.params.multiPrompt as { index: number }[];
    expect(shots.map((s) => s.index)).toEqual([2, 4]);
  });
});

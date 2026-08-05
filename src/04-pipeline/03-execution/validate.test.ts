/**
 * Spec for execution/validate.
 *
 * Contract:
 *   validateDryRun(inputs):
 *     - merges inputs.params + prompt + files.{images,video,audio,videos,audios} into a ctx
 *     - validates ctx against the model's schema via Models.validate
 *     - returns { valid, errors?, schema, context }
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { Models } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import type { ResolvedInputs } from '#root/types.ts';
import { validateDryRun } from './validate.ts';

function realModel(): ModelDefinition {
  // Pick any real enabled model — we just need a known id for validation.
  return Models.list().filter((m) => !m.disabled)[0];
}

function makeInputs(over: Partial<ResolvedInputs> = {}): ResolvedInputs {
  return {
    model: realModel(),
    params: { prompt: 'hello' },
    files: {},
    ...over,
  };
}

describe('validateDryRun', () => {
  it('returns a ValidationResult shape', () => {
    const result = validateDryRun(makeInputs());
    expect(typeof result.valid).toBe('boolean');
    expect(result.schema).toBeDefined();
    expect(result.context).toBeDefined();
  });

  it('puts prompt in the ctx', () => {
    const result = validateDryRun(makeInputs({ params: { prompt: 'a sunset' } }));
    expect(result.context?.prompt).toBe('a sunset');
  });

  it('defaults prompt to empty string when params has none', () => {
    const inputs = makeInputs({ params: {} });
    const result = validateDryRun(inputs);
    expect(result.context?.prompt).toBe('');
  });

  it('threads inputs.files into the ctx with the SDK key names', () => {
    const result = validateDryRun(
      makeInputs({
        files: { images: ['a.png', 'b.png'], video: 'v.mp4', audio: 'a.mp3' },
      }),
    );
    expect(result.context?.imageUrls).toEqual(['a.png', 'b.png']);
    expect(result.context?.videoUrl).toBe('v.mp4');
    expect(result.context?.audioUrl).toBe('a.mp3');
  });

  it('threads files.videos / files.audios into ctx.videoUrls / ctx.audioUrls (seedance video-extend)', () => {
    const result = validateDryRun(
      makeInputs({
        files: { videos: ['v1.mp4', 'v2.mp4'], audios: ['a1.mp3'] },
      }),
    );
    expect(result.context?.videoUrls).toEqual(['v1.mp4', 'v2.mp4']);
    expect(result.context?.audioUrls).toEqual(['a1.mp3']);
  });

  it('omits image/video/audio keys when empty', () => {
    const result = validateDryRun(makeInputs({ files: {} }));
    expect('imageUrls' in (result.context ?? {})).toBe(false);
    expect('videoUrl' in (result.context ?? {})).toBe(false);
    expect('audioUrl' in (result.context ?? {})).toBe(false);
    expect('videoUrls' in (result.context ?? {})).toBe(false);
    expect('audioUrls' in (result.context ?? {})).toBe(false);
  });

  it('extends ctx with arbitrary inputs.params', () => {
    const result = validateDryRun(makeInputs({ params: { aspectRatio: '16:9', cfgScale: 7.5 } }));
    expect(result.context?.aspectRatio).toBe('16:9');
    expect(result.context?.cfgScale).toBe(7.5);
  });
});

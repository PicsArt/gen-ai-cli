/**
 * Spec for resolve/text-analysis.
 *
 * finalizeTextAnalysisInputs(inputs, flags, flow):
 *   - defaults an empty prompt to a describe instruction
 *   - throws UsageError when neither image nor video is present
 *   - keeps a video-capable model (gemini) as-is for video input
 *   - auto-switches a defaulted non-video model to a video-capable one
 *   - throws when the user explicitly forced a non-video model with -m + video
 *
 * Uses the real SDK catalog: claude-sonnet-4-6 (no videoUrl) and
 * gemini-3-pro (videoUrl) are the fixtures.
 */
import { getModel } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '#flows';
import { UsageError } from '#infra/errors/usage.ts';
import type { ResolvedInputs } from '#root/types.ts';
import { finalizeTextAnalysisInputs } from './text-analysis.ts';

const flow = FLOWS.describe;

function inputs(modelId: string, files: ResolvedInputs['files'], prompt?: string): ResolvedInputs {
  const model = getModel(modelId);
  if (!model) throw new Error(`fixture model missing: ${modelId}`);
  return { model, params: prompt === undefined ? {} : { prompt }, files };
}

describe('finalizeTextAnalysisInputs — prompt default', () => {
  it('fills a default prompt when none is given', () => {
    const out = finalizeTextAnalysisInputs(inputs('claude-sonnet-4-6', { images: ['https://x/a.jpg'] }), {}, flow);
    expect(typeof out.params.prompt).toBe('string');
    expect((out.params.prompt as string).length).toBeGreaterThan(0);
  });

  it('preserves an explicit prompt', () => {
    const out = finalizeTextAnalysisInputs(
      inputs('claude-sonnet-4-6', { images: ['https://x/a.jpg'] }, 'what brand?'),
      {},
      flow,
    );
    expect(out.params.prompt).toBe('what brand?');
  });
});

describe('finalizeTextAnalysisInputs — media requirement', () => {
  it('throws UsageError when no image or video is present', () => {
    expect(() => finalizeTextAnalysisInputs(inputs('claude-sonnet-4-6', {}), {}, flow)).toThrow(UsageError);
  });
});

describe('finalizeTextAnalysisInputs — video routing', () => {
  it('keeps a video-capable model for video input', () => {
    const out = finalizeTextAnalysisInputs(
      inputs('gemini-3-pro', { video: 'https://x/clip.mp4' }),
      { model: 'gemini-3-pro' },
      flow,
    );
    expect(out.model.id).toBe('gemini-3-pro');
  });

  it('auto-switches a defaulted non-video model to a video-capable one', () => {
    // no flags.model → defaulted
    const out = finalizeTextAnalysisInputs(inputs('claude-sonnet-4-6', { video: 'https://x/clip.mp4' }), {}, flow);
    expect(out.model.id).toBe('gemini-3-pro');
  });

  it('throws when the user explicitly forced a non-video model with a video', () => {
    const resolved = inputs('claude-sonnet-4-6', { video: 'https://x/clip.mp4' });
    expect(() => finalizeTextAnalysisInputs(resolved, { model: 'claude-sonnet-4-6' }, flow)).toThrow(UsageError);
  });
});

describe('finalizeTextAnalysisInputs — general ask flow (media optional)', () => {
  const ask = FLOWS.ask;

  it('allows a text-only prompt (no media required)', () => {
    const out = finalizeTextAnalysisInputs(inputs('claude-sonnet-4-6', {}, 'find current trends'), {}, ask);
    expect(out.params.prompt).toBe('find current trends');
    expect(out.model.id).toBe('claude-sonnet-4-6');
  });

  it('does not inject a default analysis prompt', () => {
    const out = finalizeTextAnalysisInputs(inputs('claude-sonnet-4-6', {}), {}, ask);
    expect(out.params.prompt).toBeUndefined();
  });

  it('still routes video to a video-capable model', () => {
    const out = finalizeTextAnalysisInputs(inputs('claude-sonnet-4-6', { video: 'https://x/clip.mp4' }), {}, ask);
    expect(out.model.id).toBe('gemini-3-pro');
  });
});

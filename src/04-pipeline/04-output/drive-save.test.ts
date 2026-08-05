/**
 * Spec for output/drive-save helpers.
 *
 * Contract:
 *   buildDriveSaveAttributes(model, ctx):
 *     - returns attributes with tool / model / prompt / subType / service
 *     - duration is stringified when present
 *     - aspectRatio / resolution / quality / referenceUrls go into JSON `textScript`
 *     - omits `textScript` when there are no extras
 *
 *   generateSmartFilename(url, mode, prompt, modelName, inputType, runCompletion):
 *     - returns a filename with the right extension for the URL/mode
 *     - falls back to a basic prompt-slug when prompt is missing
 *     - falls back to a basic name when the LLM throws / returns empty
 *     - on success, sanitizes (kebab-case, lowercase, no special chars) and appends shortId.ext
 */
import type { GenerationContext, ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import { buildDriveSaveAttributes, generateSmartFilename, type RunCompletion } from './drive-save.ts';

function model(over: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: 'flux-pro',
    modelId: undefined,
    inputType: 't2i',
    provider: 'picsart',
    mode: 'image',
    ...over,
  } as ModelDefinition;
}

function ctx(over: Partial<GenerationContext> = {}): GenerationContext {
  return { prompt: 'a sunset', ...over } as GenerationContext;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  buildDriveSaveAttributes                                              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('buildDriveSaveAttributes — core fields', () => {
  it('returns tool, model id, prompt, subType, service', () => {
    const a = buildDriveSaveAttributes(model({ id: 'flux-pro' }), ctx({ prompt: 'sunset' }));
    expect(a.tool).toBe('ai-playground');
    expect(a.model).toBe('flux-pro');
    expect(a.prompt).toBe('sunset');
    expect(a.subType).toBe('t2i');
    expect(a.service).toBe('picsart');
  });

  it('prefers model.modelId over model.id when both set', () => {
    const a = buildDriveSaveAttributes(model({ id: 'flux-pro', modelId: 'override' }), ctx());
    expect(a.model).toBe('override');
  });

  it('falls back to model.id when modelId is undefined', () => {
    const a = buildDriveSaveAttributes(model({ id: 'flux-pro' }), ctx());
    expect(a.model).toBe('flux-pro');
  });

  it('uses empty string for missing prompt', () => {
    const a = buildDriveSaveAttributes(model(), { prompt: undefined } as unknown as GenerationContext);
    expect(a.prompt).toBe('');
  });
});

describe('buildDriveSaveAttributes — duration', () => {
  it('stringifies duration when present', () => {
    const a = buildDriveSaveAttributes(model(), ctx({ duration: 7 } as GenerationContext));
    expect(a.duration).toBe('7');
  });

  it('omits duration when missing', () => {
    const a = buildDriveSaveAttributes(model(), ctx());
    expect('duration' in a).toBe(false);
  });
});

describe('buildDriveSaveAttributes — textScript JSON extras', () => {
  it('packs aspectRatio, resolution, quality into textScript', () => {
    const a = buildDriveSaveAttributes(
      model(),
      ctx({ aspectRatio: '16:9', resolution: '1080p', quality: 'high' } as GenerationContext),
    );
    const extras = JSON.parse(a.textScript);
    expect(extras).toEqual({ aspectRatio: '16:9', resolution: '1080p', quality: 'high' });
  });

  it('packs imageUrls / videoUrl / audioUrl into textScript as reference fields', () => {
    const a = buildDriveSaveAttributes(
      model(),
      ctx({
        imageUrls: ['a.png', 'b.png'],
        videoUrl: 'v.mp4',
        audioUrl: 'a.mp3',
      } as GenerationContext),
    );
    const extras = JSON.parse(a.textScript);
    expect(extras.referenceImageUrls).toEqual(['a.png', 'b.png']);
    expect(extras.referenceVideoUrl).toBe('v.mp4');
    expect(extras.referenceAudioUrl).toBe('a.mp3');
  });

  it('omits textScript when there are no extras', () => {
    const a = buildDriveSaveAttributes(model(), ctx());
    expect('textScript' in a).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  generateSmartFilename                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

describe('generateSmartFilename — extension', () => {
  const noop: RunCompletion = vi.fn().mockResolvedValue(undefined);

  it('picks the URL extension when it is a known media type', async () => {
    const name = await generateSmartFilename('https://x/y.png', 'image', 'a sunset', 'Flux', 't2i', noop);
    expect(name.endsWith('.png')).toBe(true);
  });

  it('falls back to mp4 for video URLs without a recognized extension', async () => {
    const name = await generateSmartFilename('https://x/y', 'video', 'clip', 'Veo', 't2v', noop);
    expect(name.endsWith('.mp4')).toBe(true);
  });

  it('falls back to mp3 for audio mode', async () => {
    const name = await generateSmartFilename('https://x/y', 'audio', 'tune', 'Lyria', 'music', noop);
    expect(name.endsWith('.mp3')).toBe(true);
  });

  it('falls back to png for image mode when extension is unknown', async () => {
    const name = await generateSmartFilename('https://x/y', 'image', undefined, 'Flux', 't2i', noop);
    expect(name.endsWith('.png')).toBe(true);
  });
});

describe('generateSmartFilename — LLM path', () => {
  it('uses sanitized LLM response when available', async () => {
    const llm: RunCompletion = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Golden Hour Mountain' } }],
    });
    const name = await generateSmartFilename('https://x/y.png', 'image', 'sunset', 'Flux', 't2i', llm);
    expect(name).toMatch(/^golden-hour-mountain-\d+\.png$/);
  });

  it('falls back to prompt-slug when LLM throws', async () => {
    const llm: RunCompletion = vi.fn().mockRejectedValue(new Error('LLM down'));
    const name = await generateSmartFilename('https://x/y.png', 'image', 'crisp morning shot', 'Flux', 't2i', llm);
    expect(name).toMatch(/crisp-morning-shot-\d+\.png/);
  });

  it('falls back when LLM returns empty content', async () => {
    const llm: RunCompletion = vi.fn().mockResolvedValue({ choices: [{ message: { content: '' } }] });
    const name = await generateSmartFilename('https://x/y.png', 'image', 'p', 'Flux', 't2i', llm);
    expect(name).toMatch(/\.png$/);
  });

  it('skips LLM entirely when no prompt is provided', async () => {
    const llm: RunCompletion = vi.fn();
    await generateSmartFilename('https://x/y.png', 'image', undefined, 'Flux', 't2i', llm);
    expect(llm).not.toHaveBeenCalled();
  });
});

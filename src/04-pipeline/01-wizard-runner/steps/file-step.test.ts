/**
 * Spec for the file step.
 *
 * Contract:
 *   runFileStep(deps, model, flags):
 *     - maps CLI flag names → SDK ctx keys before calling promptForInputFiles
 *     - merges any answers from promptForInputFiles over flag-derived values
 *     - returns the merged result shaped as ResolvedInputs['files']
 *     - --image and --reference-image accept either string or string[]
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { CliDeps } from '#root/deps.ts';

const prefetchDriveMediaMock = vi.hoisted(() => vi.fn());
const promptForInputFilesMock = vi.hoisted(() => vi.fn());

vi.mock('#pipeline/01-wizard-runner/prompts/prompt-params.ts', () => ({
  prefetchDriveMedia: prefetchDriveMediaMock,
  promptForInputFiles: promptForInputFilesMock,
}));

import { runFileStep } from './file-step.ts';

const model: ModelDefinition = { id: 'm-1', mode: 'image', inputType: 'i2i' } as ModelDefinition;
const deps = {} as CliDeps;

describe('runFileStep — flag mapping', () => {
  it('wraps a single --image string into an array', async () => {
    prefetchDriveMediaMock.mockReset().mockResolvedValue({});
    promptForInputFilesMock.mockReset().mockResolvedValue({});
    const out = await runFileStep(deps, model, { image: '/a.png' });
    expect(out.images).toEqual(['/a.png']);
  });

  it('passes --image array through untouched', async () => {
    prefetchDriveMediaMock.mockReset().mockResolvedValue({});
    promptForInputFilesMock.mockReset().mockResolvedValue({});
    const out = await runFileStep(deps, model, { image: ['/a.png', '/b.png'] });
    expect(out.images).toEqual(['/a.png', '/b.png']);
  });

  it('maps every file-shaped flag onto the result', async () => {
    prefetchDriveMediaMock.mockReset().mockResolvedValue({});
    promptForInputFilesMock.mockReset().mockResolvedValue({});
    const out = await runFileStep(deps, model, {
      'start-frame': '/s.png',
      'end-frame': '/e.png',
      video: '/v.mp4',
      audio: '/a.mp3',
      'video-urls': ['/r1.mp4', '/r2.mp4'],
      'audio-urls': ['/r1.mp3'],
      'static-mask': '/mask.png',
      'scene-image': '/scene.png',
      'style-image': '/style.png',
    });
    expect(out.startFrame).toBe('/s.png');
    expect(out.endFrame).toBe('/e.png');
    expect(out.video).toBe('/v.mp4');
    expect(out.audio).toBe('/a.mp3');
    expect(out.videos).toEqual(['/r1.mp4', '/r2.mp4']);
    expect(out.audios).toEqual(['/r1.mp3']);
    expect(out.staticMask).toBe('/mask.png');
    expect(out.sceneImage).toBe('/scene.png');
    expect(out.styleImage).toBe('/style.png');
  });
});

describe('runFileStep — merging prompted values over flags', () => {
  it('overlays answers from promptForInputFiles on top of flag values', async () => {
    prefetchDriveMediaMock.mockReset().mockResolvedValue({});
    promptForInputFilesMock.mockReset().mockResolvedValue({ imageUrls: ['/picked.png'] });
    const out = await runFileStep(deps, model, { image: '/flag.png' });
    expect(out.images).toEqual(['/picked.png']);
  });

  it('adds new keys from prompt answers that flags did not provide', async () => {
    prefetchDriveMediaMock.mockReset().mockResolvedValue({});
    promptForInputFilesMock.mockReset().mockResolvedValue({ videoUrl: '/picked.mp4' });
    const out = await runFileStep(deps, model, {});
    expect(out.video).toBe('/picked.mp4');
  });
});

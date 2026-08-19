/**
 * Spec for `promptForInputFiles` — array file slots (`videoUrls` / `audioUrls`).
 *
 * Models like seedance-2.0-video-extend declare their ONLY file input as
 * the array slot `videoUrls` (no `videoUrl`); seed-audio models likewise
 * use `audioUrls`. The wizard must be able to collect those slots —
 * otherwise interactive users cannot run these models at all.
 *
 * Contract:
 *   - model declares `videoUrls` → prompt (up to `max` files) and return
 *     `{ videoUrls: [...] }`
 *   - model declares `audioUrls` → same, `{ audioUrls: [...] }`
 *   - slot already prefilled in ctx (from flags) → do not re-ask
 *   - user picks nothing on an optional slot → key absent from updates
 */
import type { GenerationContext, ModelDefinition } from '@picsart/ai-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getFileParamMock = vi.hoisted(() => vi.fn());
const promptFileInputMock = vi.hoisted(() => vi.fn());
const promptImageInputsMock = vi.hoisted(() => vi.fn());
const selectWithNavMock = vi.hoisted(() => vi.fn());

vi.mock('@picsart/ai-sdk', async () => {
  const real = await vi.importActual<typeof import('@picsart/ai-sdk')>('@picsart/ai-sdk');
  return { ...real, Models: { ...real.Models, getFileParam: getFileParamMock } };
});
vi.mock('./prompt-input.ts', () => ({
  promptFileInput: promptFileInputMock,
  promptImageInputs: promptImageInputsMock,
}));
vi.mock('../nav.ts', () => ({
  selectWithNav: selectWithNavMock,
  askWithNav: vi.fn(),
  confirmWithNav: vi.fn(),
}));
vi.mock('#services/drive.ts', () => ({
  listDriveMedia: vi.fn().mockResolvedValue([]),
}));

import { promptForInputFiles } from './prompt-params.ts';

const emptyCtx: Partial<GenerationContext> = {};

function makeModel(inputType: string): ModelDefinition {
  return { id: 'm-test', name: 'Test model', inputType, mode: 'video' } as ModelDefinition;
}

/** Configure getFileParam to answer only for the given slot keys. */
function declareSlots(slots: Record<string, { required?: boolean; max?: number; label?: string }>) {
  getFileParamMock.mockImplementation((_id: string, key: string) => slots[key]);
}

afterEach(() => {
  getFileParamMock.mockReset();
  promptFileInputMock.mockReset();
  promptImageInputsMock.mockReset();
  selectWithNavMock.mockReset();
});

describe('promptForInputFiles — videoUrls array slot', () => {
  it('collects videos for a model that declares only videoUrls (seedance extend shape)', async () => {
    declareSlots({ videoUrls: { required: true, max: 3, label: 'Videos' } });
    // First pick returns a file, second pick returns nothing (user done).
    promptFileInputMock.mockResolvedValueOnce(['/clip.mp4']).mockResolvedValue([]);

    const updates = await promptForInputFiles(makeModel('v2v'), emptyCtx);

    expect(updates.videoUrls).toEqual(['/clip.mp4']);
    expect(promptFileInputMock).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'video' }));
  });

  it('collects up to the declared max', async () => {
    declareSlots({ videoUrls: { required: true, max: 2 } });
    promptFileInputMock.mockResolvedValueOnce(['/a.mp4']).mockResolvedValueOnce(['/b.mp4']);

    const updates = await promptForInputFiles(makeModel('v2v'), emptyCtx);

    expect(updates.videoUrls).toEqual(['/a.mp4', '/b.mp4']);
    expect(promptFileInputMock).toHaveBeenCalledTimes(2);
  });

  it('does not re-ask when ctx.videoUrls is already prefilled from flags', async () => {
    declareSlots({ videoUrls: { required: true, max: 3 } });

    const updates = await promptForInputFiles(makeModel('v2v'), { videoUrls: ['/from-flag.mp4'] });

    expect(promptFileInputMock).not.toHaveBeenCalled();
    expect(updates.videoUrls).toBeUndefined();
  });

  it('leaves videoUrls absent when the user picks nothing', async () => {
    declareSlots({ videoUrls: { required: false, max: 3 } });
    promptFileInputMock.mockResolvedValue([]);

    const updates = await promptForInputFiles(makeModel('v2v'), emptyCtx);

    expect(updates.videoUrls).toBeUndefined();
  });
});

describe('promptForInputFiles — audioUrls array slot', () => {
  it('collects audios for a model that declares audioUrls', async () => {
    declareSlots({ audioUrls: { required: false, max: 2, label: 'Reference audio' } });
    promptFileInputMock.mockResolvedValueOnce(['/track.mp3']).mockResolvedValue([]);

    const updates = await promptForInputFiles(makeModel('a2a'), emptyCtx);

    expect(updates.audioUrls).toEqual(['/track.mp3']);
    expect(promptFileInputMock).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'audio' }));
  });

  it('does not re-ask when ctx.audioUrls is already prefilled from flags', async () => {
    declareSlots({ audioUrls: { required: false, max: 2 } });

    const updates = await promptForInputFiles(makeModel('a2a'), { audioUrls: ['/from-flag.mp3'] });

    expect(promptFileInputMock).not.toHaveBeenCalled();
    expect(updates.audioUrls).toBeUndefined();
  });
});

describe('promptForInputFiles — styleReferenceUrls image-array slot', () => {
  // recraft v4 style models (recraftv4_styles*) are t2i and declare their ONLY
  // (required) file input as `styleReferenceUrls`. Without wizard support the
  // interactive path early-returns and the model rejects at submit with
  // `"styleReferenceUrls" is required`.
  it('collects style references for a t2i model that declares only styleReferenceUrls', async () => {
    declareSlots({ styleReferenceUrls: { required: true, max: 5, label: 'Style References' } });
    promptImageInputsMock.mockResolvedValue(['https://cdn/ref1.png', 'https://cdn/ref2.png']);

    const updates = await promptForInputFiles(makeModel('t2i'), emptyCtx);

    expect((updates as { styleReferenceUrls?: string[] }).styleReferenceUrls).toEqual([
      'https://cdn/ref1.png',
      'https://cdn/ref2.png',
    ]);
    expect(promptImageInputsMock).toHaveBeenCalledWith('Style References', true, 5, undefined);
  });

  it('does not re-ask when ctx.styleReferenceUrls is already prefilled from flags', async () => {
    declareSlots({ styleReferenceUrls: { required: true, max: 5 } });

    const updates = await promptForInputFiles(makeModel('t2i'), {
      styleReferenceUrls: ['https://cdn/from-flag.png'],
    } as Partial<GenerationContext>);

    expect(promptImageInputsMock).not.toHaveBeenCalled();
    expect((updates as { styleReferenceUrls?: string[] }).styleReferenceUrls).toBeUndefined();
  });

  it('leaves styleReferenceUrls absent when the user picks nothing', async () => {
    declareSlots({ styleReferenceUrls: { required: true, max: 5 } });
    promptImageInputsMock.mockResolvedValue([]);

    const updates = await promptForInputFiles(makeModel('t2i'), emptyCtx);

    expect((updates as { styleReferenceUrls?: string[] }).styleReferenceUrls).toBeUndefined();
  });
});

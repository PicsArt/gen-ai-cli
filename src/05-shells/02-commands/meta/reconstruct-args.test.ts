/**
 * Spec for reconstruct-args — the entry→generate-args logic shared by
 * `redo` and `replay`.
 */
import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '#services/history.ts';
import { reconstructGenerateArgs } from './reconstruct-args.ts';

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'g_1a2b3c4d',
    timestamp: '2026-06-29T10:00:00.000Z',
    model: 'flux-1.1-pro',
    modelName: 'Flux 1.1 Pro',
    prompt: 'a fox in the woods',
    params: { aspectRatio: '16:9', count: 2 },
    status: 'completed',
    ...overrides,
  };
}

/** Read a flag's value from a flat args array (`--flag value`). */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('reconstructGenerateArgs', () => {
  it('replays model, prompt, and stored params as-is', () => {
    const args = reconstructGenerateArgs(entry());
    expect(flagValue(args, '--model')).toBe('flux-1.1-pro');
    expect(flagValue(args, '--prompt')).toBe('a fox in the woods');
    expect(flagValue(args, '--aspect-ratio')).toBe('16:9');
    expect(flagValue(args, '--count')).toBe('2');
  });

  it('lets explicit overrides win over stored values', () => {
    const args = reconstructGenerateArgs(entry(), { model: 'veo-3.1', prompt: 'new prompt', count: 1 });
    expect(flagValue(args, '--model')).toBe('veo-3.1');
    expect(flagValue(args, '--prompt')).toBe('new prompt');
    expect(flagValue(args, '--count')).toBe('1');
    expect(flagValue(args, '--aspect-ratio')).toBe('16:9'); // untouched stored value
  });

  it('replays media inputs and boolean params', () => {
    const args = reconstructGenerateArgs(
      entry({
        imageUrls: ['https://x/a.png', 'https://x/b.png'],
        videoUrl: 'https://x/v.mp4',
        params: { generateAudio: true },
      }),
    );
    expect(args.filter((a) => a === '--image')).toHaveLength(2);
    expect(flagValue(args, '--video')).toBe('https://x/v.mp4');
    expect(args).toContain('--generate-audio');
  });

  it('omits prompt when the entry has none and no override is given', () => {
    const args = reconstructGenerateArgs(entry({ prompt: undefined }));
    expect(args).not.toContain('--prompt');
  });

  it('passes through silent and download options', () => {
    const args = reconstructGenerateArgs(entry(), { silent: true, download: './out' });
    expect(args).toContain('--silent');
    expect(flagValue(args, '--download')).toBe('./out');
  });
});

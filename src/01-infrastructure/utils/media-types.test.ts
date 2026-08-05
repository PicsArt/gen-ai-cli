import { describe, expect, it } from 'vitest';
import { ALL_MEDIA_EXTS, AUDIO_EXTS, detectMediaType, getExtsForType, IMAGE_EXTS, VIDEO_EXTS } from './media-types.ts';

describe('detectMediaType', () => {
  it('classifies common image extensions', () => {
    expect(detectMediaType('/tmp/photo.jpg')).toBe('image');
    expect(detectMediaType('a.PNG')).toBe('image');
    expect(detectMediaType('logo.svg')).toBe('image');
    expect(detectMediaType('shot.heic')).toBe('image');
  });

  it('classifies common video extensions', () => {
    expect(detectMediaType('clip.mp4')).toBe('video');
    expect(detectMediaType('recording.MOV')).toBe('video');
    expect(detectMediaType('chunk.webm')).toBe('video');
  });

  it('classifies common audio extensions', () => {
    expect(detectMediaType('voice.mp3')).toBe('audio');
    expect(detectMediaType('track.WAV')).toBe('audio');
  });

  it('returns null for unknown extensions and pathless inputs', () => {
    expect(detectMediaType('readme.txt')).toBeNull();
    expect(detectMediaType('blob')).toBeNull();
    expect(detectMediaType('archive.tar.gz')).toBeNull();
  });
});

describe('getExtsForType', () => {
  it('returns the right set per type', () => {
    expect(getExtsForType('image')).toBe(IMAGE_EXTS);
    expect(getExtsForType('video')).toBe(VIDEO_EXTS);
    expect(getExtsForType('audio')).toBe(AUDIO_EXTS);
  });

  it('returns the union for undefined / no arg', () => {
    expect(getExtsForType()).toBe(ALL_MEDIA_EXTS);
  });
});

describe('extension sets', () => {
  it('ALL_MEDIA_EXTS is the union of image+video+audio', () => {
    for (const ext of IMAGE_EXTS) expect(ALL_MEDIA_EXTS.has(ext)).toBe(true);
    for (const ext of VIDEO_EXTS) expect(ALL_MEDIA_EXTS.has(ext)).toBe(true);
    for (const ext of AUDIO_EXTS) expect(ALL_MEDIA_EXTS.has(ext)).toBe(true);
  });
});

/**
 * Media type extension constants and detection — single source of truth.
 * Extracted to break the pool → prompt-params → prompt-input dependency chain.
 */
import * as path from 'node:path';

export const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tiff',
  '.svg',
  '.heic',
  '.heif',
  '.avif',
]);
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv']);
export const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma']);
export const ALL_MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS]);

export function detectMediaType(filePath: string): 'image' | 'video' | 'audio' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return null;
}

export function getExtsForType(type?: 'image' | 'video' | 'audio'): Set<string> {
  if (type === 'image') return IMAGE_EXTS;
  if (type === 'video') return VIDEO_EXTS;
  if (type === 'audio') return AUDIO_EXTS;
  return ALL_MEDIA_EXTS;
}

/**
 * Spec for resolve/input-dir.
 *
 * Contract:
 *   buildGenerateInputArgs(files):
 *     - all images   → --image f1 --image f2 ...
 *     - one video    → --video file
 *     - one audio    → --audio file
 *     - mixed types  → throw
 *     - unknown ext  → throw
 *     - multiple videos/audios → throw (single-file constraint)
 *
 *   planInputDir is heavy on FS + interactive prompts. Tested at the smaller surface here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildGenerateInputArgs } from './input-dir.ts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'input-dir-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFile(name: string): string {
  const full = path.join(tmpDir, name);
  fs.writeFileSync(full, 'data');
  return full;
}

describe('buildGenerateInputArgs — images', () => {
  it('emits --image for each file when all are images', () => {
    const f1 = makeFile('a.png');
    const f2 = makeFile('b.jpg');
    expect(buildGenerateInputArgs([f1, f2])).toEqual(['--image', f1, '--image', f2]);
  });

  it('accepts a single image', () => {
    const f = makeFile('a.png');
    expect(buildGenerateInputArgs([f])).toEqual(['--image', f]);
  });
});

describe('buildGenerateInputArgs — single video / audio', () => {
  it('emits --video file for a single video', () => {
    const f = makeFile('clip.mp4');
    expect(buildGenerateInputArgs([f])).toEqual(['--video', f]);
  });

  it('emits --audio file for a single audio', () => {
    const f = makeFile('voice.mp3');
    expect(buildGenerateInputArgs([f])).toEqual(['--audio', f]);
  });

  it('rejects multiple videos', () => {
    const a = makeFile('a.mp4');
    const b = makeFile('b.mp4');
    expect(() => buildGenerateInputArgs([a, b])).toThrow(/Multi mode supports exactly one/);
  });

  it('rejects multiple audios', () => {
    const a = makeFile('a.mp3');
    const b = makeFile('b.mp3');
    expect(() => buildGenerateInputArgs([a, b])).toThrow(/Multi mode supports exactly one/);
  });
});

describe('buildGenerateInputArgs — mixed / invalid', () => {
  it('rejects mixed media types', () => {
    const img = makeFile('a.png');
    const vid = makeFile('b.mp4');
    expect(() => buildGenerateInputArgs([img, vid])).toThrow(/single media type/);
  });

  it('rejects unknown extensions', () => {
    const f = makeFile('a.txt');
    expect(() => buildGenerateInputArgs([f])).toThrow(/Unsupported file type/);
  });
});

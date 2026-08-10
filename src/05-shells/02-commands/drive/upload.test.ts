import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#services/file-upload.ts', () => ({ uploadFile: vi.fn() }));
vi.mock('#services/client.ts', () => ({ getAiClient: vi.fn() }));
vi.mock('#services/auth.ts', () => ({ getToken: vi.fn() }));

import { getToken } from '#services/auth.ts';
import { getAiClient } from '#services/client.ts';
import { uploadFile } from '#services/file-upload.ts';
import Upload, { resolveUploadTargets, runUploads } from './upload.ts';

const mockedUpload = vi.mocked(uploadFile);
const mockedGetAiClient = vi.mocked(getAiClient);
const mockedGetToken = vi.mocked(getToken);
const IMAGE_EXTS = new Set(['.png']);

describe('upload --json payload', () => {
  let dir: string;
  let photo: string;
  let clip: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'upl-'));
    photo = join(dir, 'photo.png');
    clip = join(dir, 'clip.mov');
    writeFileSync(photo, 'mock');
    writeFileSync(clip, 'mock');
    mockedUpload.mockReset();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns ok with a url and driveUid per file', async () => {
    mockedUpload.mockImplementation(async (p: string) => `https://cdn/${p.split('/').pop()}`);
    const save = vi.fn().mockResolvedValue({ uid: 'drive-1', folder: { uid: 'f', name: '' } });

    const out = await runUploads({
      filePaths: [photo, clip],
      concurrency: 2,
      token: 't',
      uid: 'u',
      drive: { save },
    });

    expect(out.ok).toBe(true);
    expect(out.files).toEqual([
      { path: photo, url: 'https://cdn/photo.png', driveUid: 'drive-1', error: null },
      { path: clip, url: 'https://cdn/clip.mov', driveUid: 'drive-1', error: null },
    ]);
  });

  it('infers resourceType from the real file type rather than assuming video', async () => {
    mockedUpload.mockResolvedValue('https://cdn/x');
    const save = vi.fn().mockResolvedValue({ uid: 'd', folder: { uid: 'f', name: '' } });

    await runUploads({ filePaths: [photo, clip], concurrency: 1, token: 't', uid: 'u', drive: { save } });

    expect(save.mock.calls[0][0]).toMatchObject({ name: 'photo.png', resourceType: 'PHOTO' });
    expect(save.mock.calls[1][0]).toMatchObject({ name: 'clip.mov', resourceType: 'VIDEO' });
  });

  it('keeps the other files when one upload fails, and reports ok: false', async () => {
    mockedUpload.mockImplementation(async (p: string) => {
      if (p === photo) throw new Error('boom');
      return 'https://cdn/clip.mov';
    });
    const save = vi.fn().mockResolvedValue({ uid: 'drive-1', folder: { uid: 'f', name: '' } });

    const out = await runUploads({
      filePaths: [photo, clip],
      concurrency: 2,
      token: 't',
      uid: 'u',
      drive: { save },
    });

    expect(out.ok).toBe(false);
    expect(out.files[0]).toEqual({ path: photo, url: null, driveUid: null, error: 'boom' });
    expect(out.files[1]).toEqual({ path: clip, url: 'https://cdn/clip.mov', driveUid: 'drive-1', error: null });
  });

  it('still returns the CDN url when the Drive save fails', async () => {
    mockedUpload.mockResolvedValue('https://cdn/photo.png');
    const save = vi.fn().mockRejectedValue(new Error('drive 500'));

    const out = await runUploads({ filePaths: [photo], concurrency: 1, token: 't', uid: 'u', drive: { save } });

    expect(out.ok).toBe(false);
    expect(out.files[0].url).toBe('https://cdn/photo.png');
    expect(out.files[0].driveUid).toBeNull();
    expect(out.files[0].error).toMatch(/Drive save failed: drive 500/);
  });

  it('surfaces a reason when the SDK resolves null instead of throwing', async () => {
    mockedUpload.mockResolvedValue('https://cdn/photo.png');
    const save = vi.fn().mockResolvedValue(null);

    const out = await runUploads({ filePaths: [photo], concurrency: 1, token: 't', uid: 'u', drive: { save } });

    expect(out.ok).toBe(false);
    expect(out.files[0].url).toBe('https://cdn/photo.png');
    expect(out.files[0].driveUid).toBeNull();
    expect(out.files[0].error).toMatch(/Drive save failed: Drive returned no result/);
  });

  it('still returns the CDN url when Drive is unavailable entirely', async () => {
    mockedUpload.mockResolvedValue('https://cdn/photo.png');

    const out = await runUploads({ filePaths: [photo], concurrency: 1, token: 't', uid: 'u', drive: undefined });

    expect(out.ok).toBe(true);
    expect(out.files[0]).toEqual({ path: photo, url: 'https://cdn/photo.png', driveUid: null, error: null });
  });

  it('preserves input order regardless of completion order', async () => {
    mockedUpload.mockImplementation(async (p: string) => {
      if (p === photo) await new Promise((r) => setTimeout(r, 20));
      return `https://cdn/${p.split('/').pop()}`;
    });
    const save = vi.fn().mockResolvedValue({ uid: 'd', folder: { uid: 'f', name: '' } });

    const out = await runUploads({ filePaths: [photo, clip], concurrency: 2, token: 't', uid: 'u', drive: { save } });

    expect(out.files.map((f) => f.path)).toEqual([photo, clip]);
  });
});

describe('resolveUploadTargets', () => {
  let dir: string;
  let photo: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'upl-targets-'));
    photo = join(dir, 'photo.png');
    writeFileSync(photo, 'mock');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records a nonexistent path in `skipped` instead of dropping it silently', () => {
    const missing = join(dir, 'nope.png');
    const { filePaths, skipped } = resolveUploadTargets([photo, missing], IMAGE_EXTS, false);

    expect(filePaths).toEqual([photo]);
    expect(skipped).toEqual([{ path: missing, url: null, driveUid: null, error: `Path not found: ${missing}` }]);
  });

  it('records a wrong-extension file in `skipped` instead of dropping it silently', () => {
    const note = join(dir, 'notes.txt');
    writeFileSync(note, 'not media');
    const { filePaths, skipped } = resolveUploadTargets([photo, note], IMAGE_EXTS, false);

    expect(filePaths).toEqual([photo]);
    expect(skipped).toEqual([{ path: note, url: null, driveUid: null, error: `Unsupported file type: ${note}` }]);
  });

  it('records an empty folder in `skipped`, but a matching folder contributes no skip entry', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'upl-empty-'));
    try {
      const { filePaths, skipped } = resolveUploadTargets([dir, emptyDir], IMAGE_EXTS, false);

      expect(filePaths).toEqual([photo]);
      expect(skipped).toEqual([
        { path: emptyDir, url: null, driveUid: null, error: `No matching files found in folder: ${emptyDir}` },
      ]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('every input path is accounted for across filePaths + skipped combined', () => {
    const missing = join(dir, 'nope.png');
    const note = join(dir, 'notes.txt');
    writeFileSync(note, 'not media');
    const inputs = [photo, missing, note];

    const { filePaths, skipped } = resolveUploadTargets(inputs, IMAGE_EXTS, false);

    expect(filePaths.length + skipped.length).toBe(inputs.length);
    expect([...filePaths, ...skipped.map((s) => s.path)].sort()).toEqual([...inputs].sort());
  });
});

describe('upload command — all-skipped short-circuit', () => {
  let dir: string;
  let missing: string;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'upl-cmd-'));
    missing = join(dir, 'nope.png');
    mockedGetAiClient.mockReset();
    mockedGetToken.mockReset();
    mockedUpload.mockReset();
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    writeSpy.mockRestore();
  });

  // Mirrors the harness in dev/params.test.ts: derive from the command's own
  // prototype so BaseCommand getters (isJsonMode, out, ...) resolve for real,
  // and stub only `parse`/`deps` instead of spinning up all of oclif.
  function makeInstance(positional: string[], json = false) {
    const instance = Object.create(Upload.prototype);
    Object.assign(instance, {
      deps: {
        color: {},
        out: { info: () => undefined, success: () => undefined, error: () => undefined },
        flags: { json, quiet: false, debug: false, plain: false, noInput: false },
      },
      parse: async () => ({
        flags: { type: undefined, recursive: false, 'dry-run': false, concurrency: 3, 'max-files': 200 },
        argv: positional,
      }),
    });
    return instance;
  }

  it('reports skipped entries and never authenticates when every input is skipped', async () => {
    const instance = makeInstance([missing]);

    await Upload.prototype.run.call(instance);

    expect(mockedGetAiClient).not.toHaveBeenCalled();
    expect(mockedGetToken).not.toHaveBeenCalled();
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('writes the {ok:false, files:skipped} payload to stdout in --json mode', async () => {
    const instance = makeInstance([missing], true);

    await Upload.prototype.run.call(instance);

    expect(writeSpy).toHaveBeenCalledOnce();
    const written = JSON.parse((writeSpy.mock.calls[0]?.[0] as string).trim());
    expect(written).toEqual({
      ok: false,
      files: [{ path: missing, url: null, driveUid: null, error: `Path not found: ${missing}` }],
    });
    process.exitCode = 0;
  });
});

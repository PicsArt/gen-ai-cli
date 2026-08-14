import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#services/auth.ts', () => ({ getToken: vi.fn().mockResolvedValue({ token: 't', uid: 'u' }) }));
vi.mock('#services/file-upload.ts', () => ({ uploadFile: vi.fn().mockResolvedValue('https://cdn/x.mp4') }));
const ensureRootFolderMock = vi.hoisted(() => vi.fn());
const ensureSubfolderMock = vi.hoisted(() => vi.fn());
const saveFileToDriveMock = vi.hoisted(() => vi.fn());

vi.mock('#services/drive.ts', () => ({
  ensureRootFolder: ensureRootFolderMock,
  ensureSubfolder: ensureSubfolderMock,
  saveFileToDrive: saveFileToDriveMock,
}));

import { runUploadToDrive } from './upload-to-drive.ts';

describe('upload-to-drive', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    ensureRootFolderMock.mockReset().mockResolvedValue('folder-uid');
    ensureSubfolderMock.mockReset().mockResolvedValue('sub-uid');
    saveFileToDriveMock.mockReset().mockResolvedValue('drive-uid');
    dir = mkdtempSync(join(tmpdir(), 'utd-'));
    file = join(dir, 'video.mp4');
    writeFileSync(file, 'mock');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('uploads the local file, saves to Drive, returns drive_url', async () => {
    const out = await runUploadToDrive(file, { name: 'my video' });
    expect(out.status).toBe('ok');
    expect(out.drive_url).toBe('https://cdn/x.mp4');
    expect(out.file_name).toBe('my video.mp4');
  });

  it('routes to ensureSubfolder when --folder is set (folder must not be ignored)', async () => {
    await runUploadToDrive(file, { folder: 'my-project' });
    expect(ensureSubfolderMock).toHaveBeenCalledWith('my-project');
    expect(ensureRootFolderMock).not.toHaveBeenCalled();
    expect(saveFileToDriveMock).toHaveBeenCalledWith(expect.objectContaining({ folderUid: 'sub-uid' }));
  });

  it('uses the root folder when --folder is not set', async () => {
    await runUploadToDrive(file);
    expect(ensureRootFolderMock).toHaveBeenCalled();
    expect(ensureSubfolderMock).not.toHaveBeenCalled();
  });

  it('keeps a .png name intact and saves it as PHOTO (no forced .mp4 / VIDEO)', async () => {
    const png = join(dir, 'picture.png');
    writeFileSync(png, 'mock');
    const out = await runUploadToDrive(png);
    expect(out.file_name).toBe('picture.png');
    expect(saveFileToDriveMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'picture.png', resourceType: 'PHOTO' }),
    );
  });

  it('saves audio files as AUDIO with their own extension', async () => {
    const mp3 = join(dir, 'track.mp3');
    writeFileSync(mp3, 'mock');
    const out = await runUploadToDrive(mp3, { name: 'my track' });
    expect(out.file_name).toBe('my track.mp3');
    expect(saveFileToDriveMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my track.mp3', resourceType: 'AUDIO' }),
    );
  });

  it('still saves videos as VIDEO with the .mp4 extension', async () => {
    const out = await runUploadToDrive(file);
    expect(out.file_name).toBe('video.mp4');
    expect(saveFileToDriveMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'video.mp4', resourceType: 'VIDEO' }),
    );
  });
});

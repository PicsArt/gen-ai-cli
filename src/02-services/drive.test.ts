/**
 * Spec for the Drive adapter.
 *
 * Drive is a thin pass-through over the SDK client's `drive` namespace.
 * The contract is mostly delegation, so the tests focus on:
 *   - the right SDK method is called with the right shape of arguments
 *   - error / null paths surface as expected exceptions
 *   - fuzzy folder resolution falls back to fuzzy match when exact fails
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const driveMock = {
  ensureFolder: vi.fn(),
  folders: vi.fn(),
  allFolders: vi.fn(),
  findFolder: vi.fn(),
  list: vi.fn(),
  listDetailed: vi.fn(),
  save: vi.fn(),
};
const getAiClientMock = vi.fn();

vi.mock('./client.ts', () => ({
  getAiClient: (...args: unknown[]) => getAiClientMock(...args),
}));

import {
  ensureRootFolder,
  ensureSubfolder,
  listDriveAvailableFolders,
  listDriveFolders,
  listDriveMedia,
  listDriveMediaDetailed,
  listDriveMediaInFolder,
  listDriveMediaInFolderDetailed,
  listDriveRootFolders,
  resolveDriveFolderByName,
  resolveDriveFolderFuzzy,
  saveFileToDrive,
} from './drive.ts';

beforeEach(() => {
  for (const fn of Object.values(driveMock)) fn.mockReset();
  getAiClientMock.mockReset();
  getAiClientMock.mockResolvedValue({ drive: driveMock });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  ensureFolder wrappers                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('ensureRootFolder', () => {
  it('returns the folder uid', async () => {
    driveMock.ensureFolder.mockResolvedValue({ uid: 'root-uid', name: 'Gen AI' });
    expect(await ensureRootFolder()).toBe('root-uid');
    expect(driveMock.ensureFolder).toHaveBeenCalledWith();
  });

  it('throws when the SDK returns no folder', async () => {
    driveMock.ensureFolder.mockResolvedValue(undefined);
    await expect(ensureRootFolder()).rejects.toThrow(/root Drive folder/);
  });
});

describe('ensureSubfolder', () => {
  it('forwards the name to the SDK', async () => {
    driveMock.ensureFolder.mockResolvedValue({ uid: 'sub-uid', name: 'my-folder' });
    expect(await ensureSubfolder('my-folder')).toBe('sub-uid');
    expect(driveMock.ensureFolder).toHaveBeenCalledWith('my-folder');
  });

  it('throws with the requested name in the error when SDK fails', async () => {
    driveMock.ensureFolder.mockResolvedValue(undefined);
    await expect(ensureSubfolder('weekly-reports')).rejects.toThrow(/weekly-reports/);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Folder listing                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('folder listings', () => {
  it('listDriveFolders → drive.folders()', async () => {
    const data = [{ uid: 'f1', name: 'A' }];
    driveMock.folders.mockResolvedValue(data);
    expect(await listDriveFolders()).toEqual(data);
  });

  it('listDriveRootFolders → drive.allFolders()', async () => {
    driveMock.allFolders.mockResolvedValue([]);
    expect(await listDriveRootFolders()).toEqual([]);
  });

  it('listDriveAvailableFolders → drive.allFolders()', async () => {
    driveMock.allFolders.mockResolvedValue([{ uid: 'x', name: 'X' }]);
    expect(await listDriveAvailableFolders()).toHaveLength(1);
  });

  it('returns [] when the SDK client has no drive namespace', async () => {
    getAiClientMock.mockResolvedValue({});
    expect(await listDriveFolders()).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Folder resolution                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('resolveDriveFolderByName', () => {
  it('returns the SDK match', async () => {
    driveMock.findFolder.mockResolvedValue({ uid: 'f', name: 'inbox' });
    expect(await resolveDriveFolderByName('inbox')).toEqual({ uid: 'f', name: 'inbox' });
  });

  it('returns null when SDK returns undefined', async () => {
    driveMock.findFolder.mockResolvedValue(undefined);
    expect(await resolveDriveFolderByName('missing')).toBeNull();
  });
});

describe('resolveDriveFolderFuzzy', () => {
  it('returns the exact match when one is found', async () => {
    driveMock.findFolder.mockResolvedValue({ uid: 'e', name: 'exact' });
    expect((await resolveDriveFolderFuzzy('exact'))?.uid).toBe('e');
  });

  it('falls back to fuzzy-search across allFolders() when no exact match', async () => {
    driveMock.findFolder.mockResolvedValue(undefined);
    driveMock.allFolders.mockResolvedValue([
      { uid: 'f1', name: 'image-gen' },
      { uid: 'f2', name: 'video-gen' },
    ]);
    const match = await resolveDriveFolderFuzzy('image');
    expect(match?.uid).toBe('f1');
  });

  it('returns null when fuzzy search has zero matches', async () => {
    driveMock.findFolder.mockResolvedValue(undefined);
    driveMock.allFolders.mockResolvedValue([{ uid: 'x', name: 'foo' }]);
    expect(await resolveDriveFolderFuzzy('zzzz')).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Media listing                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('media listings', () => {
  it('listDriveMedia → drive.list({ type })', async () => {
    driveMock.list.mockResolvedValue([{ url: 'a.png' }]);
    await listDriveMedia('image');
    expect(driveMock.list).toHaveBeenCalledWith({ type: 'image' });
  });

  it('listDriveMediaInFolder → drive.list({ folder, type })', async () => {
    driveMock.list.mockResolvedValue([]);
    await listDriveMediaInFolder('folder-uid', 'video');
    expect(driveMock.list).toHaveBeenCalledWith({
      folder: { uid: 'folder-uid', name: '' },
      type: 'video',
    });
  });

  it('listDriveMediaDetailed → drive.listDetailed({ type })', async () => {
    driveMock.listDetailed.mockResolvedValue([]);
    await listDriveMediaDetailed('audio');
    expect(driveMock.listDetailed).toHaveBeenCalledWith({ type: 'audio' });
  });

  it('listDriveMediaInFolderDetailed → drive.listDetailed({ folder, type })', async () => {
    driveMock.listDetailed.mockResolvedValue([]);
    await listDriveMediaInFolderDetailed('uid', 'image');
    expect(driveMock.listDetailed).toHaveBeenCalledWith({
      folder: { uid: 'uid', name: '' },
      type: 'image',
    });
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  saveFileToDrive                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('saveFileToDrive', () => {
  it('returns the new asset uid from the SDK', async () => {
    driveMock.save.mockResolvedValue({ uid: 'saved-1' });
    expect(await saveFileToDrive({ name: 'a.png' } as never)).toBe('saved-1');
  });

  it('passes the folder when folderUid is provided', async () => {
    driveMock.save.mockResolvedValue({ uid: 'saved-2' });
    await saveFileToDrive({ name: 'a.png', folderUid: 'fold-1' } as never);
    const [, folderArg] = driveMock.save.mock.calls[0];
    expect(folderArg).toEqual({ uid: 'fold-1', name: '' });
  });

  it('throws when SDK returns no result', async () => {
    driveMock.save.mockResolvedValue(undefined);
    await expect(saveFileToDrive({ name: 'a.png' } as never)).rejects.toThrow(/save failed/i);
  });
});

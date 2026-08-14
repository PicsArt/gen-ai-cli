/**
 * Spec for buildDriveContext.
 *
 * Contract:
 *   buildDriveContext({ token, uid, uploadUrl, driveFolder? }) →
 *     Promise<DriveContext | undefined>
 *
 *   - driveFolder set   → calls ensureSubfolder(driveFolder), result.folderUid
 *   - driveFolder unset → calls ensureRootFolder()
 *   - on any failure (ensureSubfolder/ensureRootFolder throw) → returns undefined
 *   - the saveFn closure delegates to saveFileToDrive
 *   - the runCompletion closure runs CHAT_COMPLETIONS via getAiClient
 */
import { describe, expect, it, vi } from 'vitest';

const ensureRootFolderMock = vi.hoisted(() => vi.fn());
const ensureSubfolderMock = vi.hoisted(() => vi.fn());
const saveFileToDriveMock = vi.hoisted(() => vi.fn());
const runWorkflowMock = vi.hoisted(() => vi.fn());
const getAiClientMock = vi.hoisted(() => vi.fn());
const warnMock = vi.hoisted(() => vi.fn());

vi.mock('#services/drive.ts', () => ({
  ensureRootFolder: ensureRootFolderMock,
  ensureSubfolder: ensureSubfolderMock,
  saveFileToDrive: saveFileToDriveMock,
}));
vi.mock('#services/client.ts', () => ({
  getAiClient: getAiClientMock,
}));
vi.mock('#infra/ui-core/output.ts', () => ({
  getOutput: () => ({ warn: warnMock }),
}));

import { buildDriveContext } from './build-drive-context.ts';

describe('buildDriveContext — folder selection', () => {
  it('calls ensureSubfolder when driveFolder is set', async () => {
    ensureSubfolderMock.mockReset().mockResolvedValue('sub-uid');
    ensureRootFolderMock.mockReset();
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up', driveFolder: 'my-folder' });
    expect(ensureSubfolderMock).toHaveBeenCalledWith('my-folder');
    expect(ensureRootFolderMock).not.toHaveBeenCalled();
    expect(ctx?.folderUid).toBe('sub-uid');
  });

  it('calls ensureRootFolder when driveFolder is omitted', async () => {
    ensureSubfolderMock.mockReset();
    ensureRootFolderMock.mockReset().mockResolvedValue('root-uid');
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up' });
    expect(ensureRootFolderMock).toHaveBeenCalled();
    expect(ensureSubfolderMock).not.toHaveBeenCalled();
    expect(ctx?.folderUid).toBe('root-uid');
  });
});

describe('buildDriveContext — failure handling', () => {
  it('returns undefined when ensureRootFolder throws', async () => {
    ensureRootFolderMock.mockReset().mockRejectedValue(new Error('drive down'));
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up' });
    expect(ctx).toBeUndefined();
  });

  it('returns undefined when ensureSubfolder throws', async () => {
    ensureSubfolderMock.mockReset().mockRejectedValue(new Error('no perms'));
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up', driveFolder: 'x' });
    expect(ctx).toBeUndefined();
  });

  it('emits a visible Drive warning on failure — --save-to-drive must not silently no-op', async () => {
    warnMock.mockReset();
    ensureRootFolderMock.mockReset().mockRejectedValue(new Error('drive down'));
    await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up' });
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toMatch(/drive/i);
    expect(warnMock.mock.calls[0][0]).toContain('drive down');
  });
});

describe('buildDriveContext — closure wiring', () => {
  it('saveFn delegates to saveFileToDrive with the params it receives', async () => {
    ensureRootFolderMock.mockReset().mockResolvedValue('root');
    saveFileToDriveMock.mockReset().mockResolvedValue({ ok: true });
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up' });
    await ctx!.saveFn({
      url: 'u',
      name: 'n',
      resourceType: 'PHOTO',
      folderUid: 'fid',
      attributes: { a: '1' },
      previewUrl: 'p',
    });
    expect(saveFileToDriveMock).toHaveBeenCalledWith({
      url: 'u',
      name: 'n',
      resourceType: 'PHOTO',
      attributes: { a: '1' },
      folderUid: 'fid',
      previewUrl: 'p',
    });
  });

  it('runCompletion routes through getAiClient().runWorkflow with CHAT_COMPLETIONS', async () => {
    ensureRootFolderMock.mockReset().mockResolvedValue('root');
    runWorkflowMock.mockReset().mockResolvedValue({ choices: [{ message: { content: 'hi' } }] });
    getAiClientMock.mockReset().mockResolvedValue({ runWorkflow: runWorkflowMock });
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up' });
    const payload = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 64,
      temperature: 0.2,
    };
    const res = await ctx!.runCompletion(payload);
    expect(getAiClientMock).toHaveBeenCalled();
    expect(runWorkflowMock).toHaveBeenCalledWith('CHAT_COMPLETIONS', payload, { mode: 'sync' });
    expect(res).toEqual({ choices: [{ message: { content: 'hi' } }] });
  });
});

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
import type { OutputManager } from '#infra/ui-core/output.ts';

const ensureRootFolderMock = vi.hoisted(() => vi.fn());
const ensureSubfolderMock = vi.hoisted(() => vi.fn());
const saveFileToDriveMock = vi.hoisted(() => vi.fn());
const apiRunMock = vi.hoisted(() => vi.fn());
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

import { buildDriveContext } from './build-drive-context.ts';

// buildDriveContext receives its OutputManager explicitly (no getOutput
// singleton) — a stub whose `warn` is asserted in the failure-handling specs.
const outStub = { warn: warnMock } as unknown as OutputManager;

describe('buildDriveContext — folder selection', () => {
  it('calls ensureSubfolder when driveFolder is set', async () => {
    ensureSubfolderMock.mockReset().mockResolvedValue('sub-uid');
    ensureRootFolderMock.mockReset();
    const ctx = await buildDriveContext({
      token: 't',
      uid: 'u',
      uploadUrl: 'up',
      driveFolder: 'my-folder',
      out: outStub,
    });
    expect(ensureSubfolderMock).toHaveBeenCalledWith('my-folder');
    expect(ensureRootFolderMock).not.toHaveBeenCalled();
    expect(ctx?.folderUid).toBe('sub-uid');
  });

  it('calls ensureRootFolder when driveFolder is omitted', async () => {
    ensureSubfolderMock.mockReset();
    ensureRootFolderMock.mockReset().mockResolvedValue('root-uid');
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up', out: outStub });
    expect(ensureRootFolderMock).toHaveBeenCalled();
    expect(ensureSubfolderMock).not.toHaveBeenCalled();
    expect(ctx?.folderUid).toBe('root-uid');
  });
});

describe('buildDriveContext — failure handling', () => {
  it('returns undefined when ensureRootFolder throws', async () => {
    ensureRootFolderMock.mockReset().mockRejectedValue(new Error('drive down'));
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up', out: outStub });
    expect(ctx).toBeUndefined();
  });

  it('returns undefined when ensureSubfolder throws', async () => {
    ensureSubfolderMock.mockReset().mockRejectedValue(new Error('no perms'));
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up', driveFolder: 'x', out: outStub });
    expect(ctx).toBeUndefined();
  });

  it('emits a visible Drive warning on failure — --save-to-drive must not silently no-op', async () => {
    warnMock.mockReset();
    ensureRootFolderMock.mockReset().mockRejectedValue(new Error('drive down'));
    await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up', out: outStub });
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toMatch(/drive/i);
    expect(warnMock.mock.calls[0][0]).toContain('drive down');
  });
});

describe('buildDriveContext — closure wiring', () => {
  it('saveFn delegates to saveFileToDrive with the params it receives', async () => {
    ensureRootFolderMock.mockReset().mockResolvedValue('root');
    saveFileToDriveMock.mockReset().mockResolvedValue({ ok: true });
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up', out: outStub });
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

  it('runCompletion routes through getAiClient().apis.run with CHAT_COMPLETIONS', async () => {
    ensureRootFolderMock.mockReset().mockResolvedValue('root');
    // 6.x: ai.apis.run returns a WorkflowResponse — the raw body is under `.result`.
    apiRunMock.mockReset().mockResolvedValue({ result: { choices: [{ message: { content: 'hi' } }] } });
    getAiClientMock.mockReset().mockResolvedValue({ apis: { run: apiRunMock } });
    const ctx = await buildDriveContext({ token: 't', uid: 'u', uploadUrl: 'up', out: outStub });
    const payload = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 64,
      temperature: 0.2,
    };
    const res = await ctx!.runCompletion(payload);
    expect(getAiClientMock).toHaveBeenCalled();
    expect(apiRunMock).toHaveBeenCalledWith('CHAT_COMPLETIONS', payload);
    expect(res).toEqual({ choices: [{ message: { content: 'hi' } }] });
  });
});

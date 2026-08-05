import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#services/auth.ts', () => ({ getToken: vi.fn().mockResolvedValue({ token: 't', uid: 'u' }) }));
vi.mock('#services/file-upload.ts', () => ({ uploadFile: vi.fn().mockResolvedValue('https://cdn/x.mp4') }));
vi.mock('#services/drive.ts', () => ({
  ensureRootFolder: vi.fn().mockResolvedValue('folder-uid'),
  saveFileToDrive: vi.fn().mockResolvedValue('drive-uid'),
}));

import { runUploadToDrive } from './upload-to-drive.ts';

describe('upload-to-drive', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
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
});

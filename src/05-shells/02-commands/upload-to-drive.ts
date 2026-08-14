import { existsSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { Args, Flags } from '@oclif/core';
import { FileError } from '#infra/errors/file.ts';
import { detectMediaType } from '#infra/utils/media-types.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getToken } from '#services/auth.ts';
import { ensureRootFolder, ensureSubfolder, saveFileToDrive } from '#services/drive.ts';
import { uploadFile } from '#services/file-upload.ts';

export interface UploadResult {
  status: 'ok';
  drive_url: string;
  drive_uid: string;
  file_name: string;
  elapsed_ms: number;
}

export interface RunUploadToDriveOptions {
  name?: string;
  folder?: string;
}

export async function runUploadToDrive(file: string, opts: RunUploadToDriveOptions = {}): Promise<UploadResult> {
  if (!existsSync(file)) throw new FileError(file, 'file not found');
  const t0 = Date.now();

  // Derive name + Drive resource type from the actual file — never force
  // .mp4/VIDEO onto images or audio.
  const ext = extname(file).toLowerCase();
  const mediaType = detectMediaType(file);
  const resourceType = mediaType === 'image' ? 'PHOTO' : mediaType === 'audio' ? 'AUDIO' : 'VIDEO';
  const displayName = opts.name ?? basename(file);
  const finalName = ext && !displayName.toLowerCase().endsWith(ext) ? `${displayName}${ext}` : displayName;

  const { token, uid } = await getToken();
  const cdnUrl = await uploadFile(file, { token, uid });
  const folderUid = opts.folder ? await ensureSubfolder(opts.folder) : await ensureRootFolder();
  const driveUid = await saveFileToDrive({
    url: cdnUrl,
    name: finalName,
    resourceType,
    folderUid,
    attributes: { tool: 'gen-ai-cli', source: 'cli' },
  } as never);

  const result: UploadResult = {
    status: 'ok',
    drive_url: cdnUrl,
    drive_uid: driveUid,
    file_name: finalName,
    elapsed_ms: Date.now() - t0,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

export default class UploadToDrive extends BaseCommand {
  static description = 'Upload a local file to Picsart Drive';
  static args = { file: Args.string({ required: true, description: 'Local file path' }) };
  static flags = {
    ...BaseCommand.baseFlags,
    name: Flags.string({ description: 'Drive display name (default: filename)' }),
    folder: Flags.string({ description: 'Drive folder name (default: configured root)' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(UploadToDrive);
    await runUploadToDrive(args.file, { name: flags.name, folder: flags.folder });
  }
}

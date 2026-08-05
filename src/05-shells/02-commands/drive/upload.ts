/**
 * Upload command — upload local files to Picsart Drive.
 * Accepts variable positional args (file/folder paths).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Flags } from '@oclif/core';
import type { DriveFolder } from '@picsart/ai-sdk';
import { inferResourceType } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { ALL_MEDIA_EXTS, detectMediaType, getExtsForType } from '#infra/utils/media-types.ts';
import { runPool } from '#infra/utils/pool.ts';
import {
  ask,
  askFileWithCompletion,
  collectFiles,
  pickFromList,
} from '#pipeline/01-wizard-runner/prompts/prompt-files.ts';
import { isInteractive } from '#pipeline/01-wizard-runner/prompts/prompt-params.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getToken } from '#services/auth.ts';
import { getAiClient } from '#services/client.ts';
import { uploadFile } from '#services/file-upload.ts';

export default class Upload extends BaseCommand {
  static description = 'Upload files to Picsart Drive';

  static strict = false;

  static examples = [
    { command: '<%= config.bin %> upload photo.png', description: 'Upload a single file' },
    {
      command: '<%= config.bin %> upload ./renders/ -r -f "Campaign Assets" --type image',
      description: 'Upload folder recursively to named Drive folder, filter by type',
    },
    {
      command: '<%= config.bin %> upload *.mp4 --dry-run',
      description: 'Preview what would be uploaded without executing',
    },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    folder: Flags.string({
      char: 'f',
      description: 'Target Drive folder (created if needed)',
    }),
    type: Flags.string({
      char: 't',
      description: 'Filter by type: image, video, audio',
      options: ['image', 'video', 'audio'],
    }),
    recursive: Flags.boolean({
      char: 'r',
      description: 'Scan directories recursively',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'List files without uploading',
      default: false,
    }),
    concurrency: Flags.integer({
      char: 'c',
      description: 'Parallel uploads',
      default: 3,
    }),
    'max-files': Flags.integer({
      description: 'Safety limit on number of files to upload',
      default: 200,
    }),
  };

  async run() {
    const { flags, argv } = await this.parse(Upload);
    const positional = argv as string[];

    const mediaType = flags.type as 'image' | 'video' | 'audio' | undefined;
    const exts = mediaType ? getExtsForType(mediaType) : ALL_MEDIA_EXTS;
    let filePaths: string[] = [];

    if (positional.length > 0) {
      for (const p of positional) {
        const stat = fs.statSync(p, { throwIfNoEntry: false });
        if (!stat) {
          this.out.info(`Path not found: ${p}`);
          continue;
        }
        if (stat.isFile()) {
          if (exts.has(path.extname(p).toLowerCase())) {
            filePaths.push(path.resolve(p));
          }
        } else {
          filePaths.push(...collectFiles(p, exts, flags.recursive ? 10 : 1));
        }
      }
    } else if (isInteractive() && !this.noInput) {
      const input = await askFileWithCompletion('File or folder to upload: ', exts);
      if (input) filePaths = collectFiles(input, exts, flags.recursive ? 10 : 1);
    }

    if (filePaths.length === 0) {
      throw new UsageError('No files to upload. Provide files/folders as arguments.');
    }

    if (flags['dry-run']) {
      this.out.info(`Found ${filePaths.length} file(s):`);
      for (const f of filePaths) {
        const rel = path.relative(process.cwd(), f);
        const type = detectMediaType(f) ?? 'unknown';
        this.log(`  ${rel} (${type})`);
      }
      return;
    }

    if (filePaths.length > flags['max-files']) {
      throw new UsageError(
        `${filePaths.length} files exceeds --max-files (${flags['max-files']}). Use --max-files to increase or --dry-run to list.`,
      );
    }

    const ai = await getAiClient();
    if (!ai.drive) {
      throw new UsageError('Drive not available');
    }
    const { token, uid } = await getToken();

    // Resolve folder
    let folder: DriveFolder | undefined;

    if (flags.folder) {
      this.out.info(`Drive folder: ${flags.folder}`);
      folder = (await ai.drive.ensureFolder(flags.folder)) ?? undefined;
    } else if (isInteractive() && !this.noInput) {
      const folders = await ai.drive.folders();
      const items = [
        { display: 'Root (default)', value: '__root__' },
        ...folders.map((f) => ({ display: f.name, value: f.uid })),
        { display: '+ Create new folder', value: '__new__' },
      ];
      const chosen = await pickFromList('Drive folder', items, false);
      if (chosen === BACK || chosen === CANCEL) return;
      if (chosen === '__new__') {
        let name = await ask('  Folder name: ');
        while (!name.trim()) {
          name = await ask('  Folder name cannot be empty. Enter a name: ');
        }
        folder = (await ai.drive.ensureFolder(name.trim())) ?? undefined;
      } else if (chosen && chosen !== '__root__') {
        folder = folders.find((f) => f.uid === chosen);
      }
    }

    // Upload files
    let uploaded = 0;
    let failed = 0;
    let jobIdx = 0;

    await runPool(filePaths, flags.concurrency, async (filePath) => {
      const rel = path.relative(process.cwd(), filePath);
      const idx = ++jobIdx;
      this.out.info(`[${idx}/${filePaths.length}] ${rel}...`);

      try {
        const url = await uploadFile(filePath, { token, uid });
        const detectedType = detectMediaType(filePath);
        const resourceType = detectedType ? inferResourceType(detectedType) : ('PHOTO' as const);

        await ai.drive?.save(
          { url, name: path.basename(filePath), resourceType, attributes: { tool: 'gen-ai-cli' } },
          folder,
        );
        uploaded++;
        this.out.success(`\u2713 ${rel}`);
      } catch (e) {
        failed++;
        this.out.error(`${rel}: ${(e as Error).message}`);
      }
    });

    this.out.info(`\nDone: ${uploaded} uploaded, ${failed} failed`);
  }
}

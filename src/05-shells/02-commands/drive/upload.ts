/**
 * Upload command — upload local files to Picsart Drive.
 * Accepts variable positional args (file/folder paths).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Flags } from '@oclif/core';
import type { DriveClient, DriveFolder } from '@picsart/ai-sdk';
import { inferResourceType } from '@picsart/ai-sdk';
import { ExitCode } from '#infra/errors/base.ts';
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

/** One entry of the `--json` payload. `url` is the temporary Picsart CDN URL. */
export interface UploadFileEntry {
  path: string;
  url: string | null;
  driveUid: string | null;
  error: string | null;
}

/** The full `--json` payload written to stdout. `ok` is true only if every file succeeded. */
export interface UploadJsonPayload {
  ok: boolean;
  files: UploadFileEntry[];
}

export interface RunUploadsOptions {
  filePaths: string[];
  concurrency: number;
  token: string;
  uid: string;
  /** Drive surface, or undefined when Drive is unavailable — uploads still return their CDN URL. */
  drive?: Pick<DriveClient, 'save'>;
  folder?: DriveFolder;
  /** Progress sink. Defaults to no-op so this stays callable outside a command. */
  report?: {
    info(msg: string): void;
    success(msg: string): void;
    error(msg: string): void;
  };
}

/**
 * Resolve CLI positional args (file/folder paths) to concrete upload targets.
 * Every arg that doesn't resolve to an uploadable file — nonexistent, wrong
 * extension, or a folder with zero matches — comes back in `skipped` with a
 * reason instead of vanishing, so a caller building the final `files[]`
 * payload can account for every input it was given. Pure aside from the
 * filesystem `stat`/`collectFiles` calls; takes no command/flag state.
 */
export function resolveUploadTargets(
  positional: string[],
  exts: Set<string>,
  recursive: boolean,
): { filePaths: string[]; skipped: UploadFileEntry[] } {
  const filePaths: string[] = [];
  const skipped: UploadFileEntry[] = [];

  for (const p of positional) {
    const stat = fs.statSync(p, { throwIfNoEntry: false });
    if (!stat) {
      skipped.push({ path: p, url: null, driveUid: null, error: `Path not found: ${p}` });
      continue;
    }
    if (stat.isFile()) {
      if (exts.has(path.extname(p).toLowerCase())) {
        filePaths.push(path.resolve(p));
      } else {
        skipped.push({ path: p, url: null, driveUid: null, error: `Unsupported file type: ${p}` });
      }
    } else {
      const expanded = collectFiles(p, exts, recursive ? 10 : 1);
      if (expanded.length === 0) {
        skipped.push({ path: p, url: null, driveUid: null, error: `No matching files found in folder: ${p}` });
      } else {
        filePaths.push(...expanded);
      }
    }
  }

  return { filePaths, skipped };
}

/**
 * Upload every file, then Drive-save each one. Failures are recorded per file:
 * one bad file never discards the URLs of the others, and a failing Drive save
 * never discards the CDN URL that the upload already produced.
 */
export async function runUploads(opts: RunUploadsOptions): Promise<UploadJsonPayload> {
  const { filePaths, concurrency, token, uid, drive, folder } = opts;
  const noop = (): void => undefined;
  const report = opts.report ?? { info: noop, success: noop, error: noop };

  let failed = 0;
  let jobIdx = 0;
  const files: UploadFileEntry[] = filePaths.map((p) => ({ path: p, url: null, driveUid: null, error: null }));

  await runPool(
    filePaths.map((filePath, i) => ({ filePath, i })),
    concurrency,
    async ({ filePath, i }) => {
      const rel = path.relative(process.cwd(), filePath);
      const entry = files[i];
      report.info(`[${++jobIdx}/${filePaths.length}] ${rel}...`);

      const fail = (msg: string): void => {
        failed++;
        entry.error = msg;
        report.error(`${rel}: ${msg}`);
      };

      try {
        entry.url = await uploadFile(filePath, { token, uid });
      } catch (e) {
        fail((e as Error).message);
        return;
      }

      // The CDN URL exists from here on — a failing Drive save is recorded
      // against this file only and never discards it.
      //
      // No Drive surface at all is not a per-file failure: it was already
      // reported once, and driveUid: null says everything the caller needs.
      if (!drive) {
        report.success(`✓ ${rel}`);
        return;
      }

      try {
        const detectedType = detectMediaType(filePath);
        const resourceType = detectedType ? inferResourceType(detectedType) : ('PHOTO' as const);
        const saved = await drive.save(
          { url: entry.url, name: path.basename(filePath), resourceType, attributes: { tool: 'gen-ai-cli' } },
          folder,
        );
        // The SDK resolves null rather than throwing when a save is rejected —
        // surface it, otherwise the caller sees driveUid: null with no reason.
        if (!saved) {
          fail('Drive save failed: Drive returned no result');
          return;
        }
        entry.driveUid = saved.uid;
      } catch (e) {
        fail(`Drive save failed: ${(e as Error).message}`);
        return;
      }

      report.success(`✓ ${rel}`);
    },
  );

  report.info(`\nDone: ${filePaths.length - failed} uploaded, ${failed} failed`);
  return { ok: failed === 0, files };
}

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
    let skipped: UploadFileEntry[] = [];

    if (positional.length > 0) {
      ({ filePaths, skipped } = resolveUploadTargets(positional, exts, flags.recursive));
      for (const s of skipped) this.out.info(s.error as string);
    } else if (isInteractive() && !this.noInput) {
      const input = await askFileWithCompletion('File or folder to upload: ', exts);
      if (input) filePaths = collectFiles(input, exts, flags.recursive ? 10 : 1);
    }

    if (filePaths.length === 0 && skipped.length === 0) {
      throw new UsageError('No files to upload. Provide files/folders as arguments.');
    }

    // Every positional resolved to something skipped (bad path, wrong extension,
    // empty folder) — there is nothing left to upload. Return before touching auth:
    // getToken() can open a browser SSO login on an interactive TTY, which must
    // never happen just because an input path had a typo. (Errors were already
    // reported above, right after resolveUploadTargets.)
    if (filePaths.length === 0) {
      const payload: UploadJsonPayload = { ok: false, files: skipped };
      if (this.isJsonMode) process.stdout.write(`${JSON.stringify(payload)}\n`);
      process.exitCode = ExitCode.GENERAL_ERROR;
      return;
    }

    if (flags['dry-run']) {
      if (this.isJsonMode) {
        process.stdout.write(
          `${JSON.stringify({
            dryRun: true,
            files: filePaths.map((f) => ({ path: f, type: detectMediaType(f) ?? 'unknown' })),
            skipped,
          })}\n`,
        );
      } else {
        this.out.info(`Found ${filePaths.length} file(s):`);
        for (const f of filePaths) {
          const rel = path.relative(process.cwd(), f);
          const type = detectMediaType(f) ?? 'unknown';
          this.log(`  ${rel} (${type})`);
        }
        for (const s of skipped) {
          this.out.info(`  skipped: ${s.path} (${s.error})`);
        }
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

    const payload = await runUploads({
      filePaths,
      concurrency: flags.concurrency,
      token,
      uid,
      drive: ai.drive,
      folder,
      report: {
        info: (m) => this.out.info(m),
        success: (m) => this.out.success(m),
        error: (m) => this.out.error(m),
      },
    });

    // Merge in the paths that never made it to runUploads (nonexistent, wrong
    // type, or an empty folder) so `files.length` always accounts for every
    // input, and a request with any skipped path is never reported `ok: true`.
    const combined: UploadJsonPayload = {
      ok: payload.ok && skipped.length === 0,
      files: [...skipped, ...payload.files],
    };

    // stdout carries only the machine-readable payload; all progress above went to stderr.
    if (this.isJsonMode) process.stdout.write(`${JSON.stringify(combined)}\n`);

    // Partial failure must be visible to callers. Set the exit code directly
    // rather than this.exit() \u2014 the latter throws an ExitError that
    // BaseCommand.catch() renders as an unexpected-error card.
    if (!combined.ok) process.exitCode = ExitCode.GENERAL_ERROR;
  }
}

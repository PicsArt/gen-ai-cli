/**
 * Download command — download files from Picsart Drive.
 * Supports --list (JSON), --all (non-interactive), and interactive selection.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Flags } from '@oclif/core';
import type { DriveFolder, DriveMediaItem, ListOptions } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { runPool } from '#infra/utils/pool.ts';
import { askWithNav } from '#pipeline/01-wizard-runner/nav.ts';
import { pickFromList } from '#pipeline/01-wizard-runner/prompts/prompt-files.ts';
import { isInteractive } from '#pipeline/01-wizard-runner/prompts/prompt-params.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getAiClient } from '#services/client.ts';
import { cleanDriveEntry } from './list.ts';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadFile(url: string, dest: string): Promise<number> {
  const scheme = new URL(url).protocol;
  if (scheme !== 'https:' && scheme !== 'http:') throw new Error(`Unsupported URL scheme: ${scheme}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buf));
  return buf.byteLength;
}

function parseSelection(input: string, max: number): number[] {
  if (input.trim().toLowerCase() === 'all') return Array.from({ length: max }, (_, i) => i);
  const indices: number[] = [];
  for (const part of input.split(',')) {
    const trimmed = part.trim();
    const range = trimmed.split('-');
    if (range.length === 2) {
      const start = Math.max(1, Number.parseInt(range[0], 10));
      const end = Math.min(max, Number.parseInt(range[1], 10));
      for (let i = start; i <= end; i++) indices.push(i - 1);
    } else {
      const n = Number.parseInt(trimmed, 10);
      if (n >= 1 && n <= max) indices.push(n - 1);
    }
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}

/** Sanitize a filename to prevent path traversal (strips directory components and `..`). */
function safeName(name: string): string {
  const base = path.basename(name);
  if (!base || base === '.' || base === '..') return 'download';
  return base;
}

function uniquePath(dir: string, name: string, claimed: Set<string>): string {
  const sanitized = safeName(name);
  const ext = path.extname(sanitized);
  const base = path.basename(sanitized, ext);
  let destPath = path.join(dir, sanitized);
  let counter = 1;
  while (fs.existsSync(destPath) || claimed.has(destPath)) {
    destPath = path.join(dir, `${base}-${counter}${ext}`);
    counter++;
  }
  claimed.add(destPath);
  return destPath;
}

function findFolder(folders: DriveFolder[], name: string): DriveFolder | undefined {
  return (
    folders.find((f) => f.name.toLowerCase() === name.toLowerCase()) ??
    folders.find((f) => f.name.toLowerCase().includes(name.toLowerCase()))
  );
}

export default class Download extends BaseCommand {
  static description = 'Download files from Picsart Drive';

  static examples = [
    { command: '<%= config.bin %> download', description: 'Interactive file picker' },
    {
      command: '<%= config.bin %> download -f "My Board" -o ./output --all --type image',
      description: 'Download all images from folder to ./output',
    },
    {
      command: '<%= config.bin %> download --list -f "Campaign" --json',
      description: 'List folder contents as JSON without downloading',
    },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    folder: Flags.string({
      char: 'f',
      description: 'Download from a specific folder',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output directory',
      default: './downloads',
    }),
    type: Flags.string({
      char: 't',
      description: 'Filter by type: image, video, audio',
      options: ['image', 'video', 'audio'],
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Download all files (non-interactive)',
      default: false,
    }),
    list: Flags.boolean({
      char: 'l',
      description: 'List files as JSON (no download)',
      default: false,
    }),
    concurrency: Flags.integer({
      char: 'c',
      description: 'Parallel downloads',
      default: 3,
    }),
    'max-files': Flags.integer({
      description: 'Safety limit on number of files to download',
      default: 30,
    }),
  };

  async run() {
    const { flags } = await this.parse(Download);

    const ai = await getAiClient();
    if (!ai.drive) {
      throw new UsageError('Drive not available');
    }

    const filterType = flags.type as 'image' | 'video' | 'audio' | undefined;

    // --list mode: output Drive items as JSON, no download
    if (flags.list) {
      const opts: ListOptions = {};
      if (flags.folder) {
        const folders = await ai.drive.folders();
        const match = findFolder(folders, flags.folder);
        if (!match) {
          const available = folders.map((f) => f.name).join(', ') || '(none)';
          throw new UsageError(`Folder not found: "${flags.folder}". Available: ${available}`);
        }
        opts.folder = match;
      }
      if (filterType) opts.type = filterType;
      const detailed = await ai.drive.listDetailed(opts);
      this.out.json(detailed.map(cleanDriveEntry));
      return;
    }

    // Resolve folder
    let folder: DriveFolder | undefined;

    if (flags.folder) {
      const folders = await ai.drive.folders();
      const match = findFolder(folders, flags.folder);
      if (!match) {
        const available = folders.map((f) => f.name).join(', ') || '(none)';
        throw new UsageError(`Folder not found: "${flags.folder}". Available: ${available}`);
      }
      if (match.name !== flags.folder) this.out.info(`Matched folder: "${match.name}"`);
      folder = match;
    } else if (isInteractive() && !this.noInput) {
      const folders = await ai.drive.folders();
      const choices = [
        { display: 'All files', value: '__all__' },
        ...folders.map((f) => ({ display: f.name, value: f.uid })),
      ];
      const chosen = await pickFromList('Download from', choices, false);
      if (chosen === BACK || chosen === CANCEL || !chosen) return;
      if (chosen !== '__all__') {
        folder = folders.find((f) => f.uid === chosen);
      }
    }

    // List items
    let items: DriveMediaItem[] = await ai.drive.list({ folder, type: filterType });
    if (filterType) items = items.filter((item) => item.type === filterType);

    if (items.length === 0) {
      this.out.info('No files found');
      return;
    }

    // Select files
    let selected: DriveMediaItem[];

    if (flags.all) {
      selected = items;
    } else if (isInteractive() && !this.noInput) {
      this.out.info(`Found ${items.length} file(s):`);
      items.forEach((item, i) => {
        this.out.info(`  ${i + 1}) ${item.name} (${item.type})`);
      });
      this.out.info('Enter selection (e.g. 1,3,5-8 or "all"):');
      const input = await askWithNav('Selection');
      if (!input) return;
      const indices = parseSelection(input, items.length);
      if (indices.length === 0) {
        this.out.error('No valid selection');
        return;
      }
      selected = indices.map((i) => items[i]).filter(Boolean);
    } else {
      throw new UsageError('Use --all to download all files in non-interactive mode');
    }

    if (selected.length > flags['max-files']) {
      throw new UsageError(`Selected ${selected.length} files, exceeds --max-files (${flags['max-files']}).`);
    }

    fs.mkdirSync(flags.output, { recursive: true });

    let totalBytes = 0;
    let downloaded = 0;
    let failed = 0;
    let jobIdx = 0;
    const claimedPaths = new Set<string>();

    await runPool(selected, flags.concurrency, async (item) => {
      const idx = ++jobIdx;
      const destPath = uniquePath(flags.output, item.name, claimedPaths);
      this.out.info(`[${idx}/${selected.length}] ${item.name}...`);
      try {
        const bytes = await downloadFile(item.url, destPath);
        totalBytes += bytes;
        downloaded++;
        this.out.success(`\u2713 ${path.relative(process.cwd(), destPath)}`);
      } catch (e) {
        failed++;
        this.out.error(`${item.name}: ${(e as Error).message}`);
      }
    });

    this.out.success(
      `Downloaded ${downloaded} file(s) (${formatBytes(totalBytes)}) to ${flags.output}${failed > 0 ? `, ${failed} failed` : ''}`,
    );
  }
}

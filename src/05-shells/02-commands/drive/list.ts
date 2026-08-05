import { Flags } from '@oclif/core';
import type { DriveFileDetails, DriveFolder } from '@picsart/ai-sdk';
import chalk from 'chalk';
import { UsageError } from '#infra/errors/usage.ts';
import { renderCard } from '#infra/ui-core/components/card.ts';
import { renderKeyValue } from '#infra/ui-core/components/key-value.ts';
import { selectWithNav } from '#pipeline/01-wizard-runner/nav.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getAiClient } from '#services/client.ts';

export function cleanDriveEntry(d: DriveFileDetails): Record<string, unknown> {
  const entry: Record<string, unknown> = { name: d.name, type: d.type, url: d.url };
  if (d.createdAt) entry.createdAt = d.createdAt;
  if (d.model) entry.model = d.model;
  if (d.prompt) entry.prompt = d.prompt;
  if (d.service) entry.service = d.service;
  if (d.subType) entry.subType = d.subType;
  if (d.duration) entry.duration = d.duration;
  if (d.aspectRatio) entry.aspectRatio = d.aspectRatio;
  if (d.resolution) entry.resolution = d.resolution;
  if (d.quality) entry.quality = d.quality;
  if (d.referenceImageUrls?.length) entry.referenceImageUrls = d.referenceImageUrls;
  if (d.referenceVideoUrl) entry.referenceVideoUrl = d.referenceVideoUrl;
  if (d.referenceAudioUrl) entry.referenceAudioUrl = d.referenceAudioUrl;
  if (d.previewUrl) entry.previewUrl = d.previewUrl;
  return entry;
}

export default class List extends BaseCommand {
  static description = 'List Picsart Drive files with full metadata as JSON';

  static examples = [
    { command: '<%= config.bin %> list --folders', description: 'List all Drive folders' },
    {
      command: '<%= config.bin %> list -f "My Board" --type video --json',
      description: 'List videos in a folder as JSON',
    },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    folders: Flags.boolean({
      description: 'List accessible Drive folders (JSON)',
      default: false,
    }),
    folder: Flags.string({
      char: 'f',
      description: 'List files in a specific Drive folder',
    }),
    type: Flags.string({
      char: 't',
      description: 'Filter by type: image, video, audio',
      options: ['image', 'video', 'audio'],
    }),
  };

  async run() {
    const { flags } = await this.parse(List);

    const ai = await getAiClient();
    if (!ai.drive) {
      throw new UsageError('Drive not available');
    }

    if (flags.folders) {
      const folders = await ai.drive.folders();
      if (this.isJsonMode) {
        this.out.json(folders);
        return;
      }
      this.out.richTable(
        folders.map((f) => ({ name: f.name, id: f.uid ?? '' })),
        {
          columns: [
            { key: 'name', label: 'Folder' },
            { key: 'id', label: 'ID' },
          ],
        },
      );
      return;
    }

    let folder: DriveFolder | undefined;
    if (flags.folder) {
      const folders = await ai.drive.folders();
      const match = folders.find((f) => f.name.toLowerCase() === flags.folder?.toLowerCase());
      if (!match) {
        const available = folders.map((f) => f.name).join(', ') || '(none)';
        throw new UsageError(`Folder not found: "${flags.folder}". Available: ${available}`);
      }
      folder = match;
    }

    const filterType = flags.type as 'image' | 'video' | 'audio' | undefined;
    const items = await ai.drive.listDetailed({ folder, type: filterType });

    if (this.isJsonMode) {
      this.out.json(items.map(cleanDriveEntry));
      return;
    }

    if (items.length === 0) {
      this.out.info('No files found.');
      return;
    }

    // Non-interactive mode (piped, --no-input): show table and exit
    if (this.noInput) {
      const tableData = items.map((d) => ({
        name: d.name.length > 30 ? `${d.name.slice(0, 29)}\u2026` : d.name,
        type: d.type ?? '',
        model: d.model ?? '',
        url: d.url ?? '',
      }));
      this.out.richTable(tableData, {
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'type', label: 'Type' },
          { key: 'model', label: 'Model' },
          { key: 'url', label: 'URL' },
        ],
      });
      this.out.info(`${items.length} files`);
      return;
    }

    // Interactive: select a file to see details

    while (true) {
      const choices = items.map((d, i) => {
        const type = chalk.dim(d.type ?? '');
        const model = chalk.dim(d.model ?? '');
        return {
          name: `${chalk.bold(d.name)}  ${type}  ${model}`,
          value: i,
        };
      });

      const selected = await selectWithNav<number>({
        message: `${chalk.hex('#E859B4')('\u{1F4C1}')} Drive files (${items.length})`,
        choices,
        pageSize: 15,
        cancelOnly: true,
      });

      if (selected === BACK || selected === CANCEL) break;

      const d = items[selected];
      const pairs: [string, string][] = [
        ['Type', d.type ?? ''],
        ['Model', d.model ?? ''],
      ];
      if (d.prompt) pairs.push(['Prompt', d.prompt]);
      if (d.aspectRatio) pairs.push(['Ratio', d.aspectRatio]);
      if (d.resolution) pairs.push(['Resolution', d.resolution]);
      if (d.quality) pairs.push(['Quality', d.quality]);
      if (d.duration) pairs.push(['Duration', `${d.duration}s`]);
      if (d.service) pairs.push(['Service', d.service]);

      const cardLines = renderKeyValue(pairs, { color: this.color }).split('\n');
      if (d.url) {
        cardLines.push('');
        cardLines.push(`\u{1F517} ${this.color.link(d.url, d.url)}`);
      }
      if (d.previewUrl && d.previewUrl !== d.url) {
        cardLines.push(`\u{1F5BC}\u{FE0F}  ${this.color.link(d.previewUrl, d.previewUrl)}`);
      }
      if (d.referenceImageUrls?.length) {
        cardLines.push('');
        cardLines.push(this.color.dim('Reference images:'));
        for (const ref of d.referenceImageUrls) {
          cardLines.push(`  ${this.color.link(ref, ref)}`);
        }
      }

      process.stderr.write(
        '\n' +
          renderCard(cardLines, {
            color: this.color,
            title: d.name,
            maxWidth: process.stdout.columns || 120,
            plain: this.isPlainMode,
          }) +
          '\n',
      );
    }
  }
}

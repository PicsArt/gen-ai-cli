/**
 * Extend command — extend a VEO video by +7 seconds (chainable).
 * Usage: gen-ai extend --video <url|path> [options]
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { Flags } from '@oclif/core';
import { findModel } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { BaseCommand } from '#root/base-command.ts';
import { getLastEntry } from '#services/history.ts';
import Generate from '../operations/generate.ts';

const DEFAULT_EXTENSION_PROMPT = 'Continue the scene naturally with smooth motion and visual continuity.';

function detectAspectRatio(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const result = spawnSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    if (result.status !== 0) return undefined;
    const data = JSON.parse(result.stdout);
    const video = data.streams?.find((s: Record<string, unknown>) => s.codec_type === 'video');
    if (!video?.width || !video?.height) return undefined;
    const w = Number(video.width);
    const h = Number(video.height);
    const ratio = w / h;
    if (Math.abs(ratio - 16 / 9) < 0.05) return '16:9';
    if (Math.abs(ratio - 9 / 16) < 0.05) return '9:16';
    if (Math.abs(ratio - 1) < 0.05) return '1:1';
    if (Math.abs(ratio - 4 / 3) < 0.05) return '4:3';
    if (Math.abs(ratio - 3 / 4) < 0.05) return '3:4';
    return `${w}:${h}`;
  } catch {
    return undefined;
  }
}

export default class Extend extends BaseCommand {
  static description = 'Extend a VEO video by +7 seconds';

  static examples = [
    { command: '<%= config.bin %> extend --video ./clip.mp4', description: 'Extend a video by +7s' },
    {
      command:
        '<%= config.bin %> extend --video ./clip.mp4 -p "the camera pulls back" --times 3 --ar 16:9 --save-to-drive',
      description: 'Chain 3 extensions with prompt, aspect ratio, save to Drive',
    },
    {
      command: '<%= config.bin %> extend --video https://cdn.example/v.mp4 --dry-run',
      description: 'Preview payload without executing',
    },
  ];

  static flags = {
    ...BaseCommand.baseFlags,

    video: Flags.string({
      description: 'Video to extend (URL or local path)',
    }),
    model: Flags.string({
      char: 'm',
      description: 'VEO model to use',
      default: 'veo-3',
    }),
    prompt: Flags.string({
      char: 'p',
      description: 'Continuation prompt',
    }),
    times: Flags.integer({
      description: 'Chain N extensions sequentially',
      default: 1,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would run without executing',
      default: false,
    }),
    download: Flags.string({
      description: 'Download result to directory (default: ./output)',
    }),
    'aspect-ratio': Flags.string({
      description: 'Override aspect ratio (otherwise local files auto-detect)',
      aliases: ['ar'],
    }),
    'save-to-drive': Flags.boolean({
      description: 'Save result to Picsart Drive',
      default: false,
    }),
    'drive-folder': Flags.string({
      description: 'Drive subfolder name',
    }),
    'no-download': Flags.boolean({
      description: 'Do not download result',
      default: false,
    }),
    open: Flags.boolean({
      description: 'Open result in default app after generation',
      allowNo: true,
    }),
    clipboard: Flags.boolean({
      description: 'Copy result URL to clipboard',
      default: false,
    }),
  };

  async run() {
    const { flags } = await this.parse(Extend);

    // Validate times
    if (flags.times < 1) {
      throw new UsageError('--times must be at least 1');
    }

    // Resolve model
    const modelId = flags.model;
    const model = findModel(modelId);
    if (!model) {
      throw new UsageError(`Model not found: ${modelId}`);
    }
    if (!model.id.startsWith('veo-')) {
      throw new UsageError(`Only VEO models support video extension. "${model.name}" is not a VEO model.`);
    }

    // Resolve video source
    let videoUrl = flags.video;
    if (!videoUrl) {
      // Auto-detect from last history entry
      const last = getLastEntry();
      if (last?.resultUrl && last.status === 'completed') {
        videoUrl = last.rawResultUrl ?? last.resultUrl;
        this.out.info(`Using last result as video source: ${videoUrl}`);
      } else {
        throw new UsageError('--video is required. Provide a video URL or local file path.');
      }
    }

    // Auto-detect aspect ratio from local video file
    const hasExplicitAr = !!flags['aspect-ratio'];
    const detectedAr = !hasExplicitAr ? detectAspectRatio(videoUrl) : undefined;
    if (detectedAr) this.out.info(`Detected aspect ratio: ${detectedAr}`);

    this.out.info(`Model: ${model.name} | +7s per extension \u00D7 ${flags.times}`);
    const effectivePrompt = flags.prompt ?? DEFAULT_EXTENSION_PROMPT;
    this.out.info(`Prompt: ${effectivePrompt.slice(0, 80)}${effectivePrompt.length > 80 ? '\u2026' : ''}`);

    for (let i = 0; i < flags.times; i++) {
      if (flags.times > 1) this.out.info(`\nExtension ${i + 1}/${flags.times}...`);

      const genArgs: string[] = ['--model', modelId, '--video', videoUrl, '--prompt', effectivePrompt, '--silent'];

      if (flags['aspect-ratio']) {
        genArgs.push('--aspect-ratio', flags['aspect-ratio']);
      } else if (detectedAr) {
        genArgs.push('--aspect-ratio', detectedAr);
      }

      if (flags['dry-run']) genArgs.push('--dry-run');
      if (flags.download) genArgs.push('--download', flags.download);
      if (flags['no-download']) genArgs.push('--no-download');
      if (flags['save-to-drive']) genArgs.push('--save-to-drive');
      if (flags['drive-folder']) genArgs.push('--drive-folder', flags['drive-folder']);
      if (flags.open) genArgs.push('--open');
      if (flags.clipboard) genArgs.push('--clipboard');

      if (flags['dry-run']) {
        await Generate.run(genArgs);
        return;
      }

      await Generate.run(genArgs);

      // For chaining, get the new result URL from history
      if (i < flags.times - 1) {
        const latest = getLastEntry();
        if (!latest?.resultUrl || latest.status !== 'completed') {
          throw new UsageError('Extension failed — cannot chain further.');
        }
        videoUrl = latest.rawResultUrl ?? latest.resultUrl;
      }
    }

    if (flags.times > 1) {
      this.out.success(`Chained ${flags.times} extensions (+${flags.times * 7}s total)`);
    }
  }
}

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ModelDefinition } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { getOutput } from '#infra/ui-core/output.ts';
import { detectMediaType, getExtsForType } from '#infra/utils/media-types.ts';
import { deduplicateIds } from '#infra/utils/pool.ts';
import { selectWithNav } from '#pipeline/01-wizard-runner/nav.ts';
import { collectFiles } from '#pipeline/01-wizard-runner/prompts/prompt-files.ts';
import { isInteractive } from '#pipeline/01-wizard-runner/prompts/prompt-params.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';

function buildJobInput(filePath: string): Record<string, unknown> {
  const type = detectMediaType(filePath);
  if (type === 'image') return { imageUrls: [filePath] };
  if (type === 'video') return { videoUrl: filePath };
  if (type === 'audio') return { audioUrl: filePath };
  throw new Error(`Unsupported file type: ${filePath}`);
}

interface InputDirFlags {
  inputDir: string;
  model: string;
  prompt?: string;
  multi: boolean;
  batch: boolean;
  type?: 'image' | 'video' | 'audio';
  maxFiles: number;
  concurrency: number;
  dryRun: boolean;
  silent: boolean;
  extraArgs: string[];
}

export function buildGenerateInputArgs(files: string[]): string[] {
  const inputTypes = [...new Set(files.map(detectMediaType))];
  if (inputTypes.includes(null)) {
    throw new Error('Unsupported file type in directory input');
  }

  const mediaTypes = inputTypes as Array<'image' | 'video' | 'audio'>;
  if (mediaTypes.length !== 1) {
    throw new Error('Multi mode requires files of a single media type');
  }

  const type = mediaTypes[0];
  if (type === 'image') {
    return files.flatMap((file) => ['--image', file]);
  }
  if (files.length !== 1) {
    throw new Error(`Multi mode supports exactly one ${type} file. Use --batch instead.`);
  }
  return type === 'video' ? ['--video', files[0]] : ['--audio', files[0]];
}

function getBatchOutputArgs(extraArgs: string[]): string[] {
  const batchArgs: string[] = [];
  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i];
    if (arg === '--download' && i + 1 < extraArgs.length) {
      batchArgs.push('--output', extraArgs[++i]);
      continue;
    }
    if (arg === '--no-download') {
      batchArgs.push('--no-download');
    }
  }
  return batchArgs;
}

export type InputDirPlan =
  | { kind: 'cancelled' }
  | { kind: 'multi-generate'; generateArgs: string[] }
  | { kind: 'run-batch'; batchArgs: string[]; tmpFile: string };

/**
 * Resolve --input-dir flags into an executable plan. Pure data — the caller
 * (commands/generate.ts) executes it. This keeps services/ free of imports
 * from commands/ and breaks the previous circular dependency.
 */
export async function planInputDir(flags: InputDirFlags, model: ModelDefinition): Promise<InputDirPlan> {
  const out = getOutput();
  const exts = getExtsForType(flags.type);
  const files = collectFiles(path.resolve(flags.inputDir), exts, 0);

  if (files.length === 0) {
    throw new UsageError(`No matching files found in: ${flags.inputDir}`);
  }
  if (files.length > flags.maxFiles) {
    throw new UsageError(
      `Found ${files.length} files, exceeds --max-files (${flags.maxFiles}). Use --max-files to increase.`,
    );
  }

  out.info(`Found ${files.length} file(s) in ${flags.inputDir}`);

  let mode: 'multi' | 'batch';
  if (flags.multi) {
    mode = 'multi';
  } else if (flags.batch) {
    mode = 'batch';
  } else if (isInteractive() && !flags.silent) {
    const modeChoice = await selectWithNav<'multi' | 'batch'>({
      message: 'Input directory mode',
      choices: [
        { name: 'Multi-image \u2014 send all files as inputs to one generation', value: 'multi' },
        { name: 'Batch \u2014 one generation per file', value: 'batch' },
      ],
    });
    if (modeChoice === BACK || modeChoice === CANCEL) return { kind: 'cancelled' };
    mode = modeChoice;
  } else {
    throw new UsageError('--input-dir requires --multi or --batch in non-interactive mode');
  }

  if (mode === 'multi') {
    if (files.length > 14) {
      throw new UsageError(`Multi mode supports max 14 files, got ${files.length}. Use --batch instead.`);
    }
    const generateArgs: string[] = ['--model', model.id, ...buildGenerateInputArgs(files), ...flags.extraArgs];
    if (flags.prompt) generateArgs.push('--prompt', flags.prompt);
    if (flags.dryRun) generateArgs.push('--dry-run');
    if (flags.silent) generateArgs.push('--silent');
    return { kind: 'multi-generate', generateArgs };
  }

  const manifest = {
    defaults: { ...(flags.prompt ? { prompt: flags.prompt } : {}) },
    jobs: files.map((f) => ({
      id: path.basename(f, path.extname(f)),
      model: model.id,
      ...buildJobInput(f),
    })),
  };
  deduplicateIds(manifest.jobs);

  const tmpFile = path.join(os.tmpdir(), `gen-ai-batch-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(manifest, null, 2));

  const batchArgs = [tmpFile, '--concurrency', String(flags.concurrency), ...getBatchOutputArgs(flags.extraArgs)];
  if (flags.dryRun) batchArgs.push('--dry-run');

  return { kind: 'run-batch', batchArgs, tmpFile };
}

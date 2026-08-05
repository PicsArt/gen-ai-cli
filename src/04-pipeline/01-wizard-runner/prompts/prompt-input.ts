/**
 * File-input prompting — handles clipboard paste, recent files, local browsing,
 * Drive browsing, and URL input for media files.
 * Extracted from prompt-params.ts to keep files focused and under the 600-line limit.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import input from '@inquirer/input';
import type { DriveMediaItem } from '@picsart/ai-sdk';
import chalk from 'chalk';
import { inquirerTheme, safePrompt } from '#infra/ui/theme.ts';
import { extractClipboardImage, hasClipboardImage } from '#infra/utils/clipboard.ts';
import { IMAGE_EXTS } from '#infra/utils/media-types.ts';
import { previewFile, supportsInlineImages } from '#infra/utils/terminal-image.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { getRecentFilesByType, trackRecentFile } from '#services/history.ts';
import { selectWithNav } from '../nav.ts';
import { askFileWithCompletion, browseDrive, pickFromList } from './prompt-files.ts';

/** Prompt for text using @inquirer/input (works reliably after selectWithNav). */
async function askInput(message: string): Promise<string> {
  const result = await safePrompt(() => input({ message, theme: inquirerTheme }));
  return result.trim();
}

export type InputSource = 'local' | 'drive' | 'url' | 'paste' | 'recent' | 'skip' | 'folder';
export interface PromptFileInputOptions {
  allowFolderSelection?: boolean;
  multipleFromFolder?: boolean;
}

export function appendImageSelections(
  selected: string[],
  next: string | string[],
  limit: number,
): { values: string[]; truncated: boolean } {
  const values = (Array.isArray(next) ? next : [next]).map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return { values: selected, truncated: false };

  const remaining = Math.max(0, limit - selected.length);
  const appended = values.slice(0, remaining);
  return {
    values: [...selected, ...appended],
    truncated: values.length > appended.length,
  };
}

/** Extract image from clipboard, preview it, and return temp path. Returns null on failure. */
export function handleClipboardPaste(): string | null {
  const tmpPath = extractClipboardImage();
  if (!tmpPath) {
    return null;
  }
  if (supportsInlineImages()) previewFile(tmpPath);
  return tmpPath;
}

/** Build display items from recent files for use in pickFromList. */
export function buildRecentFileItems(files: { path: string; usedAt: string }[]): { display: string; value: string }[] {
  return files.map((f) => ({
    display: `${path.relative(process.cwd(), f.path)} ${chalk.dim(f.usedAt.slice(0, 10))}`,
    value: f.path,
  }));
}

export interface PromptFileInputParams {
  label: string;
  required: boolean;
  exts: Set<string>;
  mediaType: 'image' | 'video' | 'audio';
  drive?: {
    items?: DriveMediaItem[];
  };
  options?: PromptFileInputOptions;
}

/** Ask user to pick input source, then browse/select from that source. */
export async function promptFileInput(params: PromptFileInputParams): Promise<string[]> {
  const { label, required, exts, mediaType, drive } = params;
  const driveAvailable = !!drive;

  // Check if clipboard has an image (for image inputs)
  const clipboardHasImage = mediaType === 'image' && hasClipboardImage();
  const recentFiles = getRecentFilesByType(mediaType);

  // No Drive auth → simple mode with paste + recent + tab-completion
  if (!driveAvailable && !clipboardHasImage && recentFiles.length === 0) {
    const file = await askFileWithCompletion(`${chalk.bold(label)}: `, exts);
    return file ? [file] : [];
  }

  // Build choices array for @inquirer/select
  const sourceChoices: { name: string; value: InputSource }[] = [];

  if (clipboardHasImage) {
    sourceChoices.push({ name: '📋 Paste from clipboard', value: 'paste' });
  }

  if (recentFiles.length > 0) {
    sourceChoices.push({ name: `🕐 Recent files (${recentFiles.length})`, value: 'recent' });
  }

  // "Drop or paste path" — user drags a file from Finder or types a local path
  sourceChoices.push({ name: '📎 Drop file or paste path', value: 'local' });

  if (driveAvailable) {
    const driveCount = drive?.items?.length ?? 0;
    sourceChoices.push({
      name: `☁️  Picsart Drive (${driveCount} ${mediaType}${driveCount !== 1 ? 's' : ''})`,
      value: 'drive',
    });
  }

  sourceChoices.push({ name: '🔗 Enter URL', value: 'url' });

  if (!required) {
    sourceChoices.push({ name: chalk.dim('Done — continue to prompt'), value: 'skip' });
  }

  while (true) {
    const source = await selectWithNav<InputSource>({
      message: `${label} input`,
      choices: sourceChoices,
    });

    if (source === BACK || source === CANCEL) return [];

    switch (source) {
      case 'paste': {
        const tmpPath = handleClipboardPaste();
        if (!tmpPath) continue;
        return [tmpPath];
      }

      case 'recent': {
        const items = buildRecentFileItems(recentFiles);
        const chosen = await pickFromList(`Recent ${mediaType}s`, items);
        if (chosen === BACK || chosen === CANCEL || !chosen) return [];
        if (supportsInlineImages() && fs.existsSync(chosen)) previewFile(chosen);
        return [chosen];
      }

      case 'local': {
        // Path input — use @inquirer/input (works reliably after selectWithNav)
        const filePath = await askInput('Drop file or paste path');
        if (!filePath) continue;
        // macOS drag-and-drop wraps paths in single quotes
        const cleaned = filePath.replace(/['"]/g, '').trim();
        if (!cleaned) continue;
        const resolved = path.resolve(cleaned);
        if (!fs.existsSync(resolved)) {
          continue;
        }
        trackRecentFile(resolved, mediaType);
        if (supportsInlineImages() && mediaType === 'image') {
          previewFile(resolved);
        }
        return [resolved];
      }

      case 'drive': {
        const driveResult = await browseDrive(mediaType, drive?.items ?? []);
        if (driveResult === BACK || driveResult === CANCEL || !driveResult) return [];
        return [driveResult];
      }

      case 'url': {
        const url = await askInput('Enter URL');
        return url ? [url] : [];
      }
      default:
        return [];
    }
  }
}

export async function promptImageInputs(
  label: string,
  required: boolean,
  maxImages: number,
  drive?: { images?: DriveMediaItem[] },
): Promise<string[]> {
  const values: string[] = [];
  const total = Math.max(1, maxImages);

  for (let i = 0; i < total; i++) {
    const isRequired = required && i === 0;
    const promptLabel =
      total === 1
        ? `${label} (${isRequired ? 'required' : 'optional'})`
        : `${label} ${i + 1} of ${total} (${isRequired ? 'required' : 'optional'})`;

    const files = await promptFileInput({
      label: promptLabel,
      required: isRequired,
      exts: IMAGE_EXTS,
      mediaType: 'image',
      drive: drive ? { items: drive.images } : undefined,
      options: { allowFolderSelection: true, multipleFromFolder: true },
    });

    if (files.length === 0) {
      // User cancelled — exit even if required (don't trap them)
      break;
    }

    const result = appendImageSelections(values, files, total);
    values.splice(0, values.length, ...result.values);
    // Future hook: warn the user when their selection was truncated.
    // For now, the prompt loop just enforces the cap silently.
    if (values.length >= total) break;
  }

  return values;
}

/**
 * File selection helpers extracted from prompt-params for file size management.
 * Handles tab-completion, local file collection, and Drive browsing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import checkbox from '@inquirer/checkbox';
import type { DriveMediaItem } from '@picsart/ai-sdk';
import chalk from 'chalk';
import { inquirerTheme, safePrompt } from '#infra/ui/theme.ts';
import { getOutput } from '#infra/ui-core/output.ts';
import type { NavResult } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { listDriveFolders, listDriveMediaInFolder } from '#services/drive.ts';
import { selectWithNav } from '../nav.ts';

export const PAGE_SIZE = 15;

/** Recursively collect files matching extensions (max 2 levels deep) */
export function collectFiles(dir: string, exts: Set<string>, maxDepth = 2, depth = 0): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < maxDepth) {
        results.push(...collectFiles(full, exts, maxDepth, depth + 1));
      } else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) {
        results.push(full);
      }
    }
  } catch {
    /* permission error — skip silently (internal, not user-facing) */
  }
  return results;
}

/** Prompt for a file path with tab completion for local filesystem. */
export function askFileWithCompletion(question: string, exts: Set<string>): Promise<string> {
  return new Promise((resolve) => {
    const MAX_COMPLETION_RESULTS = 50;
    const completer = (line: string): [string[], string] => {
      if (!line) {
        // Shallow scan only (depth 0) to avoid freezing on large dirs
        const files = collectFiles(process.cwd(), exts, 0).slice(0, MAX_COMPLETION_RESULTS);
        return [files.map((f) => path.relative(process.cwd(), f)), line];
      }

      const resolved = path.resolve(line);
      let dir: string;
      let prefix: string;

      try {
        if (fs.statSync(resolved).isDirectory()) {
          dir = resolved;
          prefix = '';
        } else {
          dir = path.dirname(resolved);
          prefix = path.basename(resolved).toLowerCase();
        }
      } catch {
        dir = path.dirname(resolved);
        prefix = path.basename(resolved).toLowerCase();
      }

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const matches: string[] = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const nameLower = entry.name.toLowerCase();
          if (prefix && !nameLower.startsWith(prefix)) continue;
          const full = path.join(dir, entry.name);
          const rel = path.relative(process.cwd(), full);
          if (entry.isDirectory()) {
            matches.push(rel + path.sep);
          } else if (exts.has(path.extname(entry.name).toLowerCase())) {
            matches.push(rel);
          }
        }
        return [matches, line];
      } catch {
        return [[], line];
      }
    };

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
    });

    rl.on('close', () => resolve(''));
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Browse local files matching extensions: show list if found, otherwise fall back to tab-completion. */
export async function browseLocalFiles(exts: Set<string>, label: string, multi?: boolean): Promise<string | string[]> {
  const localFiles = collectFiles(process.cwd(), exts);
  if (localFiles.length > 0) {
    const items = localFiles.map((f) => {
      const rel = path.relative(process.cwd(), f);
      return { name: rel, value: rel };
    });

    if (multi && items.length > 1) {
      const selected = await safePrompt(() =>
        checkbox({
          message: `${label} (space to select, enter to confirm)`,
          choices: items,
          pageSize: PAGE_SIZE,
          theme: inquirerTheme,
        }),
      );
      return selected.length > 0 ? selected : [];
    }

    const result = await pickFromList(
      label,
      items.map((i) => ({ display: i.name, value: i.value })),
    );
    if (result === BACK || result === CANCEL) return multi ? [] : '';
    return multi ? (result ? [result] : []) : result;
  }
  const file = await askFileWithCompletion(`  ${chalk.bold('Path')}: `, exts);
  return multi ? (file ? [file] : []) : file;
}

/** Show a searchable list of items and let user pick one, or type a custom value. */
export async function pickFromList(
  label: string,
  items: { display: string; value: string }[],
  allowCustom = true,
): Promise<NavResult<string>> {
  if (items.length === 0) {
    if (!allowCustom) return '';
    return ask(`${chalk.bold(label)}: `);
  }

  const choices: { name: string; value: string }[] = items.map((item) => ({
    name: item.display,
    value: item.value,
  }));

  if (allowCustom) {
    choices.push({ name: chalk.dim('Type a path/URL directly...'), value: '__custom__' });
  }

  const answer = await selectWithNav({ message: label, choices, pageSize: PAGE_SIZE });

  if (answer === BACK || answer === CANCEL) return answer;

  if (answer === '__custom__') {
    return ask(`  ${chalk.bold('Path or URL')}: `);
  }

  return answer;
}

/** Browse Drive: show folders + all files, let user drill into a folder. */
export async function browseDrive(
  mediaType: 'image' | 'video' | 'audio' | 'all',
  allItems: DriveMediaItem[],
): Promise<NavResult<string>> {
  // Load folders
  let folders: { uid: string; name: string }[] = [];
  try {
    folders = await listDriveFolders();
  } catch {
    getOutput().info('Could not load Drive folders');
  }

  const label = mediaType === 'all' ? 'file' : mediaType;

  // Build location picker: "All files" + each folder
  const locations: { display: string; value: string }[] = [
    { display: `All ${label}s (${allItems.length})`, value: '__all__' },
    ...folders.map((f) => ({ display: `${f.name}/`, value: f.uid })),
  ];

  const chosen = await pickFromList('Browse Drive', locations, false);
  if (chosen === BACK || chosen === CANCEL) return chosen;
  if (!chosen) return '';

  let items: DriveMediaItem[];
  if (chosen === '__all__') {
    items = allItems;
  } else {
    // Fetch media from the selected folder (fetch all types when browsing generically)
    try {
      items =
        mediaType === 'all' ? await listDriveMediaInFolder(chosen) : await listDriveMediaInFolder(chosen, mediaType);
    } catch {
      getOutput().info('Could not load files from this folder');
      items = [];
    }
  }

  if (items.length === 0) {
    return '';
  }

  const fileItems = items.map((item) => ({
    display: `${item.name} ${chalk.dim(item.type)}`,
    value: item.url,
  }));
  return pickFromList(`Select ${label}`, fileItems, false);
}

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.on('close', () => resolve(''));
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Navigation-aware prompt wrappers — inject Back/Cancel choices
 * into @inquirer/select, @inquirer/search, and free-text prompts.
 * Escape key triggers "back" (one step back in the wizard).
 */

import input from '@inquirer/input';
import search from '@inquirer/search';
import select from '@inquirer/select';
import chalk from 'chalk';
import { inquirerTheme, safePrompt } from '#infra/ui/theme.ts';
import type { NavResult } from './wizard-state.ts';
import { BACK, CANCEL } from './wizard-state.ts';

export const NAV_SEPARATOR = { name: chalk.dim('── ── ── ──'), value: Symbol('sep'), disabled: ' ' };
const BACK_CHOICE = { name: chalk.dim('← Back'), value: BACK } as const;
const CANCEL_CHOICE = { name: chalk.dim('✕ Cancel'), value: CANCEL } as const;

type NavEntry<T> = { name: string; value: T | typeof BACK | typeof CANCEL; disabled?: boolean | string };

interface NavOptions {
  cancelOnly?: boolean;
}

/** Append nav choices (separator + Back + Cancel) to a choices array. Exported for testing. */
export function injectNavChoices<T>(
  choices: { name: string; value: T; disabled?: boolean }[],
  opts?: NavOptions,
): NavEntry<T>[] {
  const nav: NavEntry<T>[] = [NAV_SEPARATOR as NavEntry<T>];
  if (!opts?.cancelOnly) nav.push(BACK_CHOICE);
  nav.push(CANCEL_CHOICE);
  return [...choices, ...nav];
}

/**
 * Listen for Escape key on stdin and cancel the prompt.
 * Returns a cleanup function to remove the listener.
 */
function onEscapeCancel(cancelFn: () => void): () => void {
  // Listen for 'keypress' events — inquirer's readline parses raw bytes into
  // keypress objects, so raw 'data' events are unreliable (readline swallows
  // 0x1b while waiting for potential arrow-key sequences).
  const handler = (_ch: string, key: { name?: string; ctrl?: boolean }) => {
    if (key?.name === 'escape') {
      cancelFn();
    }
  };
  process.stdin.on('keypress', handler);
  return () => process.stdin.removeListener('keypress', handler);
}

/**
 * Run an inquirer prompt with Escape → BACK support.
 * The prompt factory must return a cancelable promise (has .cancel()).
 */
async function withEscapeBack<T>(factory: () => Promise<T> & { cancel?: () => void }): Promise<NavResult<T>> {
  const promptPromise = factory();
  const cleanup = onEscapeCancel(() => promptPromise.cancel?.());
  try {
    const result = await safePrompt(() => promptPromise);
    cleanup();
    return result as NavResult<T>;
  } catch (e: unknown) {
    cleanup();
    if (e != null && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'CancelPromptError') {
      return BACK as NavResult<T>;
    }
    throw e;
  }
}

/** select() with Back/Cancel choices appended. Escape key goes back. */
export async function selectWithNav<T>(config: {
  message: string;
  choices: { name: string; value: T }[];
  default?: T;
  pageSize?: number;
  cancelOnly?: boolean;
}): Promise<NavResult<T>> {
  const { cancelOnly, ...rest } = config;
  const choices = injectNavChoices(rest.choices, { cancelOnly });
  return withEscapeBack(() =>
    select<T | typeof BACK | typeof CANCEL>({
      ...rest,
      choices,
      theme: inquirerTheme,
    }),
  );
}

/** search() with Back/Cancel as persistent bottom items. Escape key goes back. */
export async function searchWithNav<T>(config: {
  message: string;
  source: (term: string | undefined) => Promise<{ name: string; value: T }[]>;
  pageSize?: number;
}): Promise<NavResult<T>> {
  return withEscapeBack(() =>
    search<T | typeof BACK | typeof CANCEL>({
      message: config.message,
      pageSize: config.pageSize,
      theme: inquirerTheme,
      source: async (term) => {
        const items = await config.source(term);
        return injectNavChoices(items);
      },
    }),
  );
}

/** confirm() replacement using select with Yes/No/Back/Cancel. */
export async function confirmWithNav(config: { message: string; default?: boolean }): Promise<NavResult<boolean>> {
  const defaultVal = config.default ?? true;
  const choices = [
    { name: defaultVal ? chalk.bold('Yes') : 'Yes', value: true as boolean },
    { name: !defaultVal ? chalk.bold('No') : 'No', value: false as boolean },
  ];
  return selectWithNav({ message: config.message, choices });
}

/** Free-text input using @inquirer/input (works reliably in REPL mode). */
export async function askWithNav(question: string): Promise<string> {
  const result = await safePrompt(() =>
    input({
      message: question,
      theme: inquirerTheme,
    }),
  );
  return result.trim();
}

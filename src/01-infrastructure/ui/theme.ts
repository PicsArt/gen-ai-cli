/**
 * Shared inquirer theme and prompt helpers for consistent CLI styling.
 */
import chalk from 'chalk';
import { UsageError } from '../errors/index.ts';

// Picsart brand gradient: primary → secondary → purple
export const BRAND_GOLD = '#E859B4';
export const BRAND_MAGENTA = '#BD99F8';
export const BRAND_PURPLE = '#9A1A89';

export const inquirerTheme = {
  prefix: chalk.hex(BRAND_GOLD)('?'),
  style: {
    highlight: (text: string) => chalk.hex(BRAND_MAGENTA)(text),
    help: (text: string) => chalk.hex('#7A7A7A')(text),
    description: (text: string) => chalk.hex('#7A7A7A')(text),
    keysHelpTip: (keys: [string, string][]) => {
      const base = keys.map(([key, action]) => `${chalk.bold(key)} ${chalk.dim(action)}`).join(chalk.dim(' \u00B7 '));
      const extra = `${chalk.bold('esc')} ${chalk.dim('back')} \u00B7 ${chalk.bold('\u2303C')} ${chalk.dim('cancel')}`;
      return `${base} ${chalk.dim('\u00B7')} ${extra}`;
    },
  },
};

/**
 * Wrap an inquirer prompt call to handle Ctrl+C gracefully.
 * Without this, Ctrl+C throws ExitPromptError instead of exiting.
 * Throws USER_CANCEL so the REPL can catch it instead of killing the process.
 */
export async function safePrompt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: unknown) {
    if (e != null && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'ExitPromptError') {
      throw new UsageError('USER_CANCEL');
    }
    throw e;
  }
}

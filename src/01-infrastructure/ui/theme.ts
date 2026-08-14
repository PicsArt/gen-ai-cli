/**
 * Shared inquirer theme and prompt helpers for consistent CLI styling.
 */

import { UsageError } from '../errors/index.ts';
import { getColor } from '../ui-core/color.ts';

// Picsart brand gradient: primary → secondary → purple
export const BRAND_GOLD = '#E859B4';
export const BRAND_MAGENTA = '#BD99F8';
export const BRAND_PURPLE = '#9A1A89';

const HELP_GRAY = '#7A7A7A';

// Styling goes through the ColorManager (not a raw chalk instance) so the
// theme honors NO_COLOR / GEN_AI_NO_COLOR / --no-color and the terminal's
// detected color depth like every other piece of UI. `prefix` is a lazy
// getter because the manager is initialized from flags after module load.
export const inquirerTheme = {
  get prefix(): string {
    return getColor().brand('?');
  },
  style: {
    highlight: (text: string) => getColor().brandMagenta(text),
    help: (text: string) => getColor().hex(HELP_GRAY)(text),
    description: (text: string) => getColor().hex(HELP_GRAY)(text),
    keysHelpTip: (keys: [string, string][]) => {
      const color = getColor();
      const base = keys.map(([key, action]) => `${color.bold(key)} ${color.dim(action)}`).join(color.dim(' \u00B7 '));
      const extra = `${color.bold('esc')} ${color.dim('back')} \u00B7 ${color.bold('\u2303C')} ${color.dim('cancel')}`;
      return `${base} ${color.dim('\u00B7')} ${extra}`;
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

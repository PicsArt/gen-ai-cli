/**
 * REPL shortcut resolution — maps numbers to commands and handles partial
 * command matching. Reads shortcuts from the operation registry.
 */
import { OPERATIONS } from '#shells/03-entry/menu-registry.ts';

/**
 * If the input starts with a number, look up the matching operation shortcut
 * and return the corresponding command (with any trailing args preserved).
 * Returns the original input unchanged when it is not a numeric shortcut.
 */
export function resolveShortcut(input: string): string {
  const match = /^(\d+)(\s+.*)?$/.exec(input);
  if (!match) return input;

  const num = Number.parseInt(match[1], 10);
  const op = OPERATIONS.find((o) => o.shortcut === num);
  if (!op) return input;

  const extra = match[2]?.trim() ?? '';
  return extra ? `${op.command} ${extra}` : op.command;
}

/**
 * Resolve a (possibly partial) command string to a full command name.
 * - Exact match wins first.
 * - If no exact match, returns the single command that starts with `partial`.
 * - Returns `undefined` when there are zero or more than one prefix matches.
 */
export function resolvePartialCommand(partial: string, validCommands: string[]): string | undefined {
  if (validCommands.includes(partial)) return partial;

  const matches = validCommands.filter((c) => c.startsWith(partial));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Interactive REPL mode — entered when `gen-ai` is run with no command.
 * Reads the operation registry for its menu; delegates dispatch to oclif.
 */

import * as readline from 'node:readline';
import { run } from '@oclif/core';
import chalk from 'chalk';
import { CliError } from '#infra/errors/index.ts';
import { printBanner } from '#infra/ui/banner.ts';
import { showCardHelp } from '#infra/ui/custom-help.ts';
import { getColor } from '#infra/ui-core/color.ts';
import { renderCard } from '#infra/ui-core/components/card.ts';
import { getOutput } from '#infra/ui-core/output.ts';
import { printUpdateNotice } from '#services/update-check.ts';
import { getValidCommands, renderOperationMenu } from './menu.ts';
import type { Operation } from './menu-registry.ts';
import { resolvePartialCommand, resolveShortcut } from './shortcuts.ts';

const DOUBLE_CTRL_C_MS = 1000;
let lastCtrlCAt = 0;
const commandHistory: string[] = [];

/**
 * Render the REPL's "Quick Start" card — every operation command,
 * grouped by category, plus the standing `models` / `help` hints.
 * Replaces the inline pair-builder so the layout can grow with the
 * 20 operations the FlowSpec registry now exposes.
 */
function renderQuickStart(operations: readonly Operation[]): void {
  const color = getColor();
  const out = getOutput();

  const groups: Array<{ heading: string; ops: Operation[] }> = [
    { heading: 'CREATE', ops: operations.filter((o) => o.category === 'create') },
    { heading: 'EDIT', ops: operations.filter((o) => o.category === 'edit') },
    { heading: 'UTILITY', ops: operations.filter((o) => o.category === 'utility') },
  ];

  const lines: string[] = [];
  for (const g of groups) {
    if (g.ops.length === 0) continue;
    if (lines.length > 0) lines.push('');
    lines.push(color.dim(g.heading));
    for (const op of g.ops) {
      const shortcut = color.dim(`${String(op.shortcut).padStart(2)}.`);
      const cmd = color.bold(op.command.padEnd(18));
      lines.push(`  ${shortcut} ${cmd} ${color.dim(op.description)}`);
    }
  }
  lines.push('');
  lines.push(`${color.dim('     ')}${color.bold('models'.padEnd(18))} ${color.dim('Browse available models')}`);
  lines.push(`${color.dim('     ')}${color.bold('help'.padEnd(18))} ${color.dim('Show all commands')}`);

  out.result(renderCard(lines, { color, title: 'Quick Start' }));
  out.info(
    color.dim(
      '\nType a number or command name to go. Type `<command> --help` for usage examples (e.g. `image --help`).\n',
    ),
  );
}

function splitArgs(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = '';
  let escaped = false;
  for (const ch of line) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inQuote !== "'") {
      escaped = true;
      continue;
    }
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = ch;
      continue;
    }
    if (ch === inQuote) {
      inQuote = '';
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (current) args.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

let replRl: readline.Interface | null = null;

function createRl(): readline.Interface {
  const color = getColor();
  const prefix = color.brandMagenta('picsart') + chalk.dim('> ');
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    history: commandHistory as unknown as string[],
    historySize: 100,
    prompt: prefix,
    terminal: true,
  });
}

function ensureRl(): readline.Interface {
  if (!replRl) replRl = createRl();
  return replRl;
}

function suspendRl(): void {
  if (replRl) {
    replRl.close();
    replRl = null;
  }
}

function prompt(): Promise<string> {
  const rl = ensureRl();
  return new Promise((resolve) => {
    const cleanup = () => {
      rl.removeListener('line', onLine);
      rl.removeListener('close', onClose);
      rl.removeListener('SIGINT', onSigint);
    };
    const onLine = (line: string) => {
      cleanup();
      resolve(line);
    };
    const onClose = () => {
      cleanup();
      resolve('exit');
    };
    const onSigint = () => {
      cleanup();
      const now = Date.now();
      if (now - lastCtrlCAt < DOUBLE_CTRL_C_MS) {
        resolve('exit');
        return;
      }
      lastCtrlCAt = now;
      resolve('');
    };
    rl.once('line', onLine);
    rl.once('close', onClose);
    rl.once('SIGINT', onSigint);
    rl.prompt();
  });
}

export async function startRepl(version: string): Promise<void> {
  const out = getOutput();

  if (!process.stdin.isTTY) {
    out.error('REPL requires an interactive terminal (stdin is not a TTY)');
    return;
  }

  // startUpdateCheck is fired from the entry point so it covers one-shot
  // invocations too. We consume the result HERE on REPL start (not on exit)
  // because:
  //   - the user is opening the tool, willing to wait briefly for an update
  //   - on exit they're trying to leave; making them wait on `npm install -g`
  //     or a binary swap is a bad UX
  //   - the in-memory process keeps running its old binary either way; the
  //     new version is picked up on the NEXT REPL launch
  // One-shot paths still call printUpdateNotice() with no opts, which only
  // prints the notice and never runs the actual update.
  printBanner(version);
  await printUpdateNotice({ allowAutoUpdate: true });

  const { OPERATIONS } = await import('#shells/03-entry/menu-registry.ts');

  renderQuickStart(OPERATIONS);

  process.stdin.setEncoding('utf8');

  const validCommands = getValidCommands();
  const dispatchUrl = process.env.GEN_AI_OCLIF_ROOT ?? import.meta.url;

  while (true) {
    const line = await prompt();
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (commandHistory[0] !== trimmed) {
      commandHistory.unshift(trimmed);
      if (commandHistory.length > 100) commandHistory.pop();
    }

    if (trimmed === 'exit' || trimmed === 'quit') break;

    if (trimmed === 'help' || trimmed === '--help' || trimmed === '-h') {
      getOutput().result(renderOperationMenu(getColor()));
      continue;
    }

    // Resolve number shortcuts (e.g. "1" → "generate")
    const resolved = resolveShortcut(trimmed);

    // Intercept "<command> --help" for card-based help
    if (resolved.endsWith(' --help') || resolved.endsWith(' -h')) {
      const helpCmd = resolved.replace(/\s+--help$|\s+-h$/, '');
      if (showCardHelp(helpCmd)) continue;
    }

    const parts = splitArgs(resolved);
    let command = parts[0];
    let cmdArgs = parts.slice(1);

    // Accept the natural two-word form (`models info <id>`) — fold the
    // first arg into the command name when `<command>:<next>` is a real
    // oclif command id. Keeps both `models:info` and `models info` working.
    if (cmdArgs.length > 0) {
      const joined = `${command}:${cmdArgs[0]}`;
      if (validCommands.includes(joined)) {
        command = joined;
        cmdArgs = cmdArgs.slice(1);
      }
    }

    // Partial match / auto-complete
    const resolvedCommand = resolvePartialCommand(command, validCommands);
    if (!resolvedCommand) {
      out.error(`Unknown command: ${command}. Type "help" for available commands.`);
      continue;
    }

    suspendRl();

    try {
      await run([resolvedCommand, ...cmdArgs], dispatchUrl);
    } catch (err: unknown) {
      if (err instanceof CliError && err.message === 'USER_CANCEL') {
        const now = Date.now();
        if (now - lastCtrlCAt < DOUBLE_CTRL_C_MS) break;
        lastCtrlCAt = now;
      } else if (err instanceof CliError) {
        out.error(err.friendlyMessage ?? err.message);
      } else if (err instanceof Error && 'oclif' in err) {
        const oclifErr = err as Error & { oclif?: { exit?: number } };
        if (oclifErr.oclif?.exit !== 0) out.error(err.message);
      } else if (err instanceof Error) {
        out.error(err.message);
      } else {
        out.error(String(err));
      }
    }
  }
}

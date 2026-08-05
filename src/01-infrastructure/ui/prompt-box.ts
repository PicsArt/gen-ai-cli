/**
 * Rich prompt input with live command preview.
 * Uses raw stdin data events for full key detection.
 * Supports multi-line via Shift+Enter (VS Code terminal-setup: \x1b\r).
 */
import { getColor } from '../ui-core/color.ts';
import { visibleWidth } from '../ui-core/components/string-utils.ts';

export interface PromptBoxOptions {
  modelId: string;
  modelName: string;
  price?: string;
  example?: string;
}

const HORIZONTAL = '\u2500';

export function promptWithCommandBox(opts: PromptBoxOptions): Promise<string | null> {
  const color = getColor();
  const termWidth = process.stdout.columns || 80;

  if (!process.stdin.isTTY || termWidth < 40) {
    return fallbackPrompt();
  }

  return new Promise((resolve) => {
    const priceStr = opts.price ? ` ${color.dim('\u00B7')} ${color.dim(opts.price)}` : '';
    process.stderr.write(`${color.success('\u2713')} ${color.bold(opts.modelId)} selected${priceStr}\n`);

    const example = opts.example ?? 'slow dolly across neon tokyo alley, rain on pavement';
    process.stderr.write(
      color.info('\u25B8') +
        ` type your prompt and press \u21B5  ${color.dim('shift+\u21B5 new line \u00B7 esc cancel')}\n`,
    );
    process.stderr.write(`${color.dim(`  e.g. "${example}"`)}\n`);

    const ruleWidth = Math.min(termWidth - 4, 116);
    const rule = color.brand(HORIZONTAL.repeat(ruleWidth));
    const prefix = `gen-ai generate -m ${opts.modelId} -p `;
    let userText = '';
    let cursorPos = 0; // cursor position within userText
    let prevLineCount = 0; // content lines from previous render

    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();

    // Write top rule (stays forever)
    process.stderr.write(`${rule}\n`);

    function render(): void {
      // Move cursor from last content line up to first content line
      if (prevLineCount > 1) {
        process.stderr.write(`\x1B[${prevLineCount - 1}A`);
      }
      // Clear from first content line to end of screen
      process.stderr.write('\r\x1B[J');

      const promptChar = `${color.brand('\u276F')}  `;
      const dimPrefix = color.dim(prefix);
      const prefixVis = 4 + visibleWidth(prefix);
      const textLines = userText.split('\n');

      const outputLines: string[] = [];
      for (let i = 0; i < textLines.length; i++) {
        const lineText = textLines[i];
        if (i === 0) {
          const avail = ruleWidth - prefixVis;
          const display = lineText.length > avail ? lineText.slice(lineText.length - avail) : lineText;
          outputLines.push(`${promptChar}${dimPrefix}${display}`);
        } else {
          const avail = ruleWidth - 4;
          const display = lineText.length > avail ? lineText.slice(lineText.length - avail) : lineText;
          outputLines.push(`    ${display}`);
        }
      }

      // Write content lines + bottom rule (no \n after rule)
      for (const line of outputLines) {
        process.stderr.write(`${line}\n`);
      }
      process.stderr.write(rule);

      // Position cursor based on cursorPos within the text.
      // For line 0: cursor column = promptChar + dimPrefix + chars before cursor
      // For line N: cursor column = indent + chars before cursor on that line
      let charsBeforeCursor = cursorPos;
      let cursorLine = 0;
      for (let i = 0; i < textLines.length; i++) {
        if (charsBeforeCursor <= textLines[i].length) {
          cursorLine = i;
          break;
        }
        charsBeforeCursor -= textLines[i].length + 1; // +1 for \n
        cursorLine = i + 1;
      }
      charsBeforeCursor = Math.max(0, Math.min(charsBeforeCursor, (textLines[cursorLine] ?? '').length));

      const linesFromBottom = outputLines.length - cursorLine;
      // Move up from bottom rule to cursor line (+1 for the rule itself)
      process.stderr.write(`\x1B[${linesFromBottom}A`);
      // Position column
      const colOffset = cursorLine === 0 ? prefixVis + charsBeforeCursor : 4 + charsBeforeCursor;
      process.stderr.write(`\x1B[${colOffset + 1}G`);
      prevLineCount = outputLines.length;
    }

    let cleaned = false;
    function cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      process.stdin.removeListener('data', onData);
      process.removeListener('SIGINT', onSigint);
      if (process.stdin.setRawMode) process.stdin.setRawMode(false);
      process.stdin.pause();
      // Move past the bottom rule (cursor is on last content line)
      process.stderr.write('\n\n');
    }

    // Safety net: Ctrl+C in raw mode sends \x03 to data handler,
    // but if that fails, SIGINT catches it.
    function onSigint(): void {
      cleanup();
      resolve(null);
    }
    process.on('SIGINT', onSigint);

    function onData(buf: Buffer): void {
      const str = buf.toString('utf-8');

      // ESC → cancel (single ESC byte only, not part of a sequence)
      if (str === '\x1b') {
        cleanup();
        resolve(null);
        return;
      }

      // Ctrl+C → cancel
      if (str === '\x03') {
        cleanup();
        resolve(null);
        return;
      }

      // Shift+Enter → new line (VS Code terminal-setup sends \x1b\r)
      if (str === '\x1b\r') {
        userText = `${userText.slice(0, cursorPos)}\n${userText.slice(cursorPos)}`;
        cursorPos++;
        render();
        return;
      }

      // Ctrl+J (LF) → new line (fallback for other terminals)
      if (str === '\x0a') {
        userText = `${userText.slice(0, cursorPos)}\n${userText.slice(cursorPos)}`;
        cursorPos++;
        render();
        return;
      }

      // Enter (CR) → submit
      if (str === '\r') {
        if (!userText.trim()) {
          // Flash warning — clear content area, show warning, re-render
          if (prevLineCount > 0) {
            process.stderr.write(`\x1B[${prevLineCount}A\x1B[J`);
            prevLineCount = 0;
          }
          process.stderr.write(`${color.warning('  prompt cannot be empty')}\n`);
          setTimeout(() => render(), 600);
          return;
        }
        cleanup();
        resolve(userText);
        return;
      }

      // Backspace (DEL 0x7f or BS 0x08)
      if (str === '\x7f' || str === '\x08') {
        if (cursorPos > 0) {
          userText = userText.slice(0, cursorPos - 1) + userText.slice(cursorPos);
          cursorPos--;
          render();
        }
        return;
      }

      // Arrow keys (escape sequences)
      if (str === '\x1b[D') {
        // Left arrow
        if (cursorPos > 0) {
          cursorPos--;
          render();
        }
        return;
      }
      if (str === '\x1b[C') {
        // Right arrow
        if (cursorPos < userText.length) {
          cursorPos++;
          render();
        }
        return;
      }
      if (str === '\x1b[H' || str === '\x01') {
        // Home or Ctrl+A
        cursorPos = 0;
        render();
        return;
      }
      if (str === '\x1b[F' || str === '\x05') {
        // End or Ctrl+E
        cursorPos = userText.length;
        render();
        return;
      }

      // Ignore other escape sequences (up/down arrows, function keys, etc.)
      if (str.startsWith('\x1b')) return;
      // Ignore other control chars
      if (str.charCodeAt(0) < 32) return;

      // Printable characters — insert at cursor position
      userText = userText.slice(0, cursorPos) + str + userText.slice(cursorPos);
      cursorPos += str.length;
      render();
    }

    render();
    process.stdin.on('data', onData);
  });
}

async function fallbackPrompt(): Promise<string | null> {
  const readline = await import('node:readline');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Prompt: ', (answer: string) => {
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}

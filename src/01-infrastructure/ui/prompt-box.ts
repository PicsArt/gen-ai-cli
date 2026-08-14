/**
 * Rich prompt input with live command preview.
 * Uses raw stdin data events for full key detection.
 * Supports multi-line via Shift+Enter (VS Code terminal-setup: \x1b\r).
 */
import { StringDecoder } from 'node:string_decoder';
import { getColor } from '../ui-core/color.ts';
import { tailWindow, visibleWidth } from '../ui-core/components/string-utils.ts';

export interface PromptBoxOptions {
  modelId: string;
  modelName: string;
  price?: string;
  example?: string;
}

const HORIZONTAL = '\u2500';

/** Step one code point left from `pos`, never splitting a surrogate pair. */
export function prevCharBoundary(text: string, pos: number): number {
  if (pos <= 0) return 0;
  const prev = text.charCodeAt(pos - 1);
  // Low surrogate preceded by a high surrogate \u2192 step over both units.
  if (prev >= 0xdc00 && prev <= 0xdfff && pos >= 2) {
    const before = text.charCodeAt(pos - 2);
    if (before >= 0xd800 && before <= 0xdbff) return pos - 2;
  }
  return pos - 1;
}

/** Step one code point right from `pos`, never splitting a surrogate pair. */
export function nextCharBoundary(text: string, pos: number): number {
  if (pos >= text.length) return text.length;
  const cur = text.charCodeAt(pos);
  // High surrogate followed by a low surrogate \u2192 step over both units.
  if (cur >= 0xd800 && cur <= 0xdbff && pos + 1 < text.length) {
    const after = text.charCodeAt(pos + 1);
    if (after >= 0xdc00 && after <= 0xdfff) return pos + 2;
  }
  return pos + 1;
}

/**
 * Sanitize typed or pasted input before inserting it into the buffer:
 * normalize CRLF/CR to LF and drop all other control characters (a paste
 * arrives as one multi-byte chunk and may carry \r, tabs, ANSI noise).
 */
export function sanitizeInsertion(str: string): string {
  return str
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\0-\x08\x0b-\x1f\x7f]/g, '');
}

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

    const computeRuleWidth = (cols: number): number => Math.max(1, Math.min(cols - 4, 116));
    let ruleWidth = computeRuleWidth(termWidth);
    let rule = color.brand(HORIZONTAL.repeat(ruleWidth));
    const prefix = `gen-ai generate -m ${opts.modelId} -p `;
    let userText = '';
    let cursorPos = 0; // cursor position within userText
    let prevLineCount = 0; // content lines from previous render
    let prevCursorLine = 0; // content line the cursor was left on by the previous render

    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();

    // Write top rule (stays forever)
    process.stderr.write(`${rule}\n`);

    function render(): void {
      // Move cursor from the line it was left on (the previous cursor line,
      // not necessarily the last content line) up to the first content line.
      if (prevCursorLine > 0) {
        process.stderr.write(`\x1B[${prevCursorLine}A`);
      }
      // Clear from first content line to end of screen
      process.stderr.write('\r\x1B[J');

      const promptChar = `${color.brand('\u276F')}  `;
      const dimPrefix = color.dim(prefix);
      const prefixVis = 4 + visibleWidth(prefix);
      const textLines = userText.split('\n');

      // Display-width-aware tail truncation for over-long lines; remember
      // each line's window start so the cursor column can be computed
      // relative to what is actually shown.
      const windowStarts: number[] = [];
      const outputLines: string[] = [];
      for (let i = 0; i < textLines.length; i++) {
        const lineText = textLines[i];
        const avail = Math.max(0, ruleWidth - (i === 0 ? prefixVis : 4));
        const { display, startIndex } = tailWindow(lineText, avail);
        windowStarts.push(startIndex);
        outputLines.push(i === 0 ? `${promptChar}${dimPrefix}${display}` : `    ${display}`);
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
      // Position column by display width (emoji/CJK occupy 2 cells), relative
      // to the visible tail window when the line is truncated. Clamp to the
      // rule width so the cursor can't wrap onto the next terminal row.
      const lineIndent = cursorLine === 0 ? prefixVis : 4;
      const windowStart = windowStarts[cursorLine] ?? 0;
      const visibleBefore =
        charsBeforeCursor > windowStart
          ? visibleWidth((textLines[cursorLine] ?? '').slice(windowStart, charsBeforeCursor))
          : 0;
      const colOffset = Math.min(lineIndent + visibleBefore, ruleWidth - 1);
      process.stderr.write(`\x1B[${colOffset + 1}G`);
      prevLineCount = outputLines.length;
      prevCursorLine = cursorLine;
    }

    let warningTimer: NodeJS.Timeout | null = null;
    /** Erase a pending "prompt cannot be empty" flash, if one is on screen. */
    function clearWarning(): void {
      if (!warningTimer) return;
      clearTimeout(warningTimer);
      warningTimer = null;
      process.stderr.write('\x1B[1A\r\x1B[J');
    }

    let cleaned = false;
    function cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      if (warningTimer) {
        clearTimeout(warningTimer);
        warningTimer = null;
      }
      process.stdin.removeListener('data', onData);
      process.removeListener('SIGINT', onSigint);
      process.stdout.removeListener('resize', onResize);
      if (process.stdin.setRawMode) process.stdin.setRawMode(false);
      process.stdin.pause();
      // Move past the bottom rule. The cursor rests on `prevCursorLine`
      // (0-based content line), the rule sits one row below the last content
      // line — so descend (lines below cursor) + 1 for the rule + 1 to land
      // on a fresh row. '\n' (not CSI B) so the screen scrolls at the bottom.
      const linesBelowCursor = Math.max(0, prevLineCount - 1 - prevCursorLine);
      process.stderr.write('\n'.repeat(linesBelowCursor + 2));
    }

    // Safety net: Ctrl+C in raw mode sends \x03 to data handler,
    // but if that fails, SIGINT catches it.
    function onSigint(): void {
      cleanup();
      resolve(null);
    }
    process.on('SIGINT', onSigint);

    // Recompute layout when the terminal is resized: all cursor math assumes
    // one logical line per screen row, which breaks once a stale (wider)
    // ruleWidth makes the terminal hard-wrap rendered rows. render() erases
    // the old box and redraws at the new width.
    function onResize(): void {
      if (cleaned) return;
      ruleWidth = computeRuleWidth(process.stdout.columns || 80);
      rule = color.brand(HORIZONTAL.repeat(ruleWidth));
      render();
    }
    process.stdout.on('resize', onResize);

    // StringDecoder buffers a UTF-8 sequence split across chunk boundaries
    // (large pastes) instead of decoding the halves to replacement chars.
    const decoder = new StringDecoder('utf-8');

    function onData(buf: Buffer): void {
      const str = decoder.write(buf);
      if (!str) return;

      // Any key other than Enter dismisses a pending empty-prompt warning
      // (Enter manages it itself) so the follow-up render starts clean.
      if (warningTimer && str !== '\r') clearWarning();

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
          // Flash warning — move to the first content line (cursor sits on
          // prevCursorLine, not necessarily the last line), clear downward,
          // show the warning, then erase it and re-render.
          if (warningTimer) {
            // Warning already showing — keep it, restart the timer below.
            clearWarning();
          } else if (prevCursorLine > 0) {
            process.stderr.write(`\x1B[${prevCursorLine}A`);
          }
          process.stderr.write('\r\x1B[J');
          prevLineCount = 0;
          prevCursorLine = 0;
          process.stderr.write(`${color.warning('  prompt cannot be empty')}\n`);
          warningTimer = setTimeout(() => {
            warningTimer = null;
            process.stderr.write('\x1B[1A\r\x1B[J');
            render();
          }, 600);
          return;
        }
        cleanup();
        resolve(userText);
        return;
      }

      // Backspace (DEL 0x7f or BS 0x08) — delete one code point, not one
      // UTF-16 unit, so emoji are removed whole instead of leaving half a
      // surrogate pair in the prompt.
      if (str === '\x7f' || str === '\x08') {
        if (cursorPos > 0) {
          const start = prevCharBoundary(userText, cursorPos);
          userText = userText.slice(0, start) + userText.slice(cursorPos);
          cursorPos = start;
          render();
        }
        return;
      }

      // Arrow keys — move by code point. Terminals send CSI sequences
      // (\x1b[D) normally and SS3 (\x1bOD) in application-cursor-keys mode.
      if (str === '\x1b[D' || str === '\x1bOD') {
        // Left arrow
        if (cursorPos > 0) {
          cursorPos = prevCharBoundary(userText, cursorPos);
          render();
        }
        return;
      }
      if (str === '\x1b[C' || str === '\x1bOC') {
        // Right arrow
        if (cursorPos < userText.length) {
          cursorPos = nextCharBoundary(userText, cursorPos);
          render();
        }
        return;
      }
      if (str === '\x1b[H' || str === '\x1bOH' || str === '\x01') {
        // Home or Ctrl+A
        cursorPos = 0;
        render();
        return;
      }
      if (str === '\x1b[F' || str === '\x1bOF' || str === '\x05') {
        // End or Ctrl+E
        cursorPos = userText.length;
        render();
        return;
      }

      // Ignore other escape sequences (up/down arrows, function keys, etc.)
      if (str.startsWith('\x1b')) return;

      // Printable characters or a pasted chunk — sanitize (a paste arrives
      // as one multi-char chunk that may contain \r and other control
      // bytes; checking only the first char would let them through raw),
      // then insert at the cursor position.
      const insertText = sanitizeInsertion(str);
      if (!insertText) return;
      userText = userText.slice(0, cursorPos) + insertText + userText.slice(cursorPos);
      cursorPos += insertText.length;
      render();
    }

    render();
    process.stdin.on('data', onData);
  });
}

async function fallbackPrompt(): Promise<string | null> {
  const readline = await import('node:readline');
  return new Promise((resolve) => {
    // Prompt text goes to stderr like the rest of the UI — stdout is
    // reserved for results and may be piped.
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(value);
    };
    // Without a 'SIGINT' listener readline only pauses the stream on Ctrl+C,
    // leaving this promise pending forever — cancel like the raw-mode path.
    rl.on('SIGINT', () => finish(null));
    // Ctrl+D / EOF closes the interface without firing the question callback.
    rl.on('close', () => finish(null));
    rl.question('Prompt: ', (answer: string) => finish(answer.trim() || null));
  });
}

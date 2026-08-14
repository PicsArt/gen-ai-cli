import { Command } from '@oclif/core';
import { writeDebugLog } from '#infra/utils/debug-log.ts';
import { flushPulse } from '#services/pulse.ts';
import { getUserConfig } from '#services/user-config.ts';
import { CliError, ExitCode } from './01-infrastructure/errors/index.ts';
import { baseFlags } from './01-infrastructure/flags/base.ts';
import type { ColorManager } from './01-infrastructure/ui-core/color.ts';
import { createColorManager } from './01-infrastructure/ui-core/color.ts';
import { renderCard } from './01-infrastructure/ui-core/components/card.ts';
import type { OutputManager } from './01-infrastructure/ui-core/output.ts';
import { createOutputManager } from './01-infrastructure/ui-core/output.ts';
import type { CliDeps } from './deps.ts';
import { createCliDeps } from './deps.ts';

export abstract class BaseCommand extends Command {
  static baseFlags = baseFlags;

  protected deps!: CliDeps;

  // Convenience accessors (read from deps)
  protected get color(): ColorManager {
    return this.deps.color;
  }
  protected get out(): OutputManager {
    return this.deps.out;
  }

  // Backward-compatible flag accessors — existing commands use these.
  // New commands should use this.deps.flags directly.
  protected get isJsonMode(): boolean {
    return this.deps.flags.json;
  }
  protected get isQuiet(): boolean {
    return this.deps.flags.quiet;
  }
  protected get isDebug(): boolean {
    return this.deps.flags.debug;
  }
  protected get isPlainMode(): boolean {
    return this.deps.flags.plain;
  }
  protected get noInput(): boolean {
    return this.deps.flags.noInput;
  }

  async init() {
    await super.init();
    const { flags } = await this.parse(this.constructor as typeof BaseCommand);

    const color = createColorManager({
      enabled: 'auto',
      noColorFlag: flags['no-color'],
    });

    const out = createOutputManager({
      color,
      quiet: flags.quiet,
      debug: flags.debug,
      jsonMode: flags.json,
      plainMode: flags.plain,
    });

    this.deps = createCliDeps({
      color,
      out,
      config: getUserConfig(),
      flags: {
        quiet: flags.quiet,
        debug: flags.debug,
        json: flags.json,
        plain: flags.plain,
        noInput: flags['no-input'] || !process.stdin.isTTY,
      },
    });
  }

  /**
   * Append `err` to ~/.gen-ai/debug.log, returning the log path (or undefined
   * if the write failed). Never throws — a filesystem problem must not replace
   * the error the user actually hit.
   */
  private tryWriteDebugLog(err: Error): string | undefined {
    try {
      return writeDebugLog({
        cliVersion: this.config?.version ?? 'unknown',
        command: this.id ?? 'unknown',
        error: err.message,
        stack: err.stack,
      });
    } catch {
      /* filesystem error — continue with friendly message */
      return undefined;
    }
  }

  /**
   * Terminate with `code`.
   *
   * `process.exitCode` is assigned BEFORE flushing: `flushPulse()` can only
   * resolve when a Pulse context exists, and on any path where it doesn't
   * (PULSE_OPT_OUT, a stubbed entry point) the awaited promise may never
   * settle — leaving Node to exit naturally at code 0 and silently turn every
   * error into a success. Setting the field first makes the intended code the
   * process's exit code no matter which way we leave this function.
   */
  private async exitAfterFlush(code: number): Promise<never> {
    process.exitCode = code;
    // Drain Pulse before exit — this.exit() calls process.exit() which
    // skips the finally block in runWithPulse, so we must explicitly flush.
    await flushPulse();
    this.exit(code);
  }

  async catch(err: Error & { exitCode?: number }) {
    // Ensure deps are initialized — init() may not have run if oclif
    // threw for missing args or invalid flags before calling init().
    if (!this.deps) {
      const color = createColorManager({ enabled: 'auto' });
      const out = createOutputManager({
        color,
        quiet: false,
        debug: false,
        jsonMode: false,
        plainMode: false,
      });
      this.deps = createCliDeps({
        color,
        out,
        config: getUserConfig(),
        flags: { quiet: false, debug: false, json: false, plain: false, noInput: false },
      });
    }

    // User pressed Ctrl+C / ESC in an interactive prompt (safePrompt sentinel).
    // Not an error: exit silently with the dedicated cancel code — no error
    // card, no debug log. The REPL intercepts this sentinel before it gets here.
    if (err instanceof CliError && err.message === 'USER_CANCEL') {
      await this.exitAfterFlush(ExitCode.USER_CANCEL);
      return;
    }

    if (err instanceof CliError) {
      const logPath = this.tryWriteDebugLog(err);

      if (this.isJsonMode) {
        // A --json run must be machine-readable on stdout; scraping an ANSI
        // card off stderr is not a contract any script can depend on.
        process.stdout.write(
          `${JSON.stringify({
            error: err.friendlyMessage,
            code: err.exitCode,
            ...(err.hint ? { hint: err.hint } : {}),
            ...(logPath ? { debugLog: logPath } : {}),
          })}\n`,
        );
      } else {
        const lines = err.friendlyMessage.split('\n');
        if (err.hint) {
          lines.push('');
          lines.push(this.color.dim(err.hint));
        }
        if (logPath) {
          lines.push('');
          lines.push(this.color.dim(`Debug log: ${logPath}`));
        }
        process.stderr.write(
          `${renderCard(lines, {
            color: this.color,
            title: '✗ Error',
            borderColor: '#F8495A',
          })}\n`,
        );
      }
      await this.exitAfterFlush(err.exitCode);
    }

    // oclif usage errors (unknown flags, missing args, bad flag values, etc.)
    const oclif = (err as { oclif?: { exit: number } }).oclif;
    if (oclif?.exit === 2) {
      if (this.isJsonMode) {
        // Same contract as the CliError branch: --json means machine-readable
        // stdout for every error path, not just CliError.
        process.stdout.write(`${JSON.stringify({ error: err.message, code: ExitCode.USAGE_ERROR })}\n`);
      } else {
        process.stderr.write(
          `${renderCard(err.message.split('\n'), {
            color: this.color,
            title: '✗ Error',
            borderColor: '#F8495A',
          })}\n`,
        );
      }
      await this.exitAfterFlush(ExitCode.USAGE_ERROR);
    }

    // Unexpected error — show the actual message and write debug log
    const logPath = this.tryWriteDebugLog(err);
    const msg = err.message || 'Something went wrong unexpectedly.';

    if (this.isJsonMode) {
      process.stdout.write(
        `${JSON.stringify({
          error: msg,
          code: ExitCode.GENERAL_ERROR,
          ...(logPath ? { debugLog: logPath } : {}),
        })}\n`,
      );
      await this.exitAfterFlush(ExitCode.GENERAL_ERROR);
    }

    const lines = msg.split('\n');
    if (logPath) {
      lines.push('');
      lines.push(this.color.dim(`Debug log: ${logPath}`));
    }
    lines.push(this.color.dim('Report: https://github.com/PicsArt/gen-ai-cli/issues'));

    process.stderr.write(
      `${renderCard(lines, {
        color: this.color,
        title: '✗ Error',
        borderColor: '#F8495A',
      })}\n`,
    );
    await this.exitAfterFlush(ExitCode.GENERAL_ERROR);
  }
}

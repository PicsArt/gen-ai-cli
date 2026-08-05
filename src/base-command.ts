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

    if (err instanceof CliError) {
      const lines = err.friendlyMessage.split('\n');
      if (err.hint) {
        lines.push('');
        lines.push(this.color.dim(err.hint));
      }
      process.stderr.write(
        `${renderCard(lines, {
          color: this.color,
          title: '\u2717 Error',
          borderColor: '#F8495A',
        })}\n`,
      );
      // Drain Pulse before exit \u2014 this.exit() calls process.exit() which
      // skips the finally block in runWithPulse, so we must explicitly flush.
      await flushPulse();
      this.exit(err.exitCode);
    }

    // oclif usage errors (unknown flags, missing args, bad flag values, etc.)
    const oclif = (err as { oclif?: { exit: number } }).oclif;
    if (oclif?.exit === 2) {
      process.stderr.write(
        `${renderCard(err.message.split('\n'), {
          color: this.color,
          title: '\u2717 Error',
          borderColor: '#F8495A',
        })}\n`,
      );
      await flushPulse();
      this.exit(ExitCode.USAGE_ERROR);
    }

    // Unexpected error — show the actual message and write debug log
    const version = this.config?.version ?? 'unknown';
    const command = this.id ?? 'unknown';
    let logPath: string | undefined;
    try {
      logPath = writeDebugLog({
        cliVersion: version,
        command,
        error: err.message,
        stack: err.stack,
      });
    } catch {
      /* filesystem error — continue with friendly message */
    }

    const msg = err.message || 'Something went wrong unexpectedly.';
    const lines = msg.split('\n');
    if (logPath) {
      lines.push('');
      lines.push(this.color.dim(`Debug log: ${logPath}`));
    }
    lines.push(this.color.dim('Report: https://github.com/PicsArt/gen-ai-cli/issues'));

    process.stderr.write(
      `${renderCard(lines, {
        color: this.color,
        title: '\u2717 Error',
        borderColor: '#F8495A',
      })}\n`,
    );
    await flushPulse();
    this.exit(ExitCode.GENERAL_ERROR);
  }
}

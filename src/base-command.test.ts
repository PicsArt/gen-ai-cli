/**
 * Spec for BaseCommand.catch — the CLI-wide error boundary.
 *
 * Contract under --json: EVERY error path must emit a one-line JSON object
 * `{error, code, ...}` on stdout — not just CliError. Scripts parse stdout;
 * an ANSI card on stderr with empty stdout breaks them.
 */
import type { Config } from '@oclif/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExitCode } from './01-infrastructure/errors/index.ts';

const flushPulseMock = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));
const writeDebugLogMock = vi.hoisted(() => vi.fn(() => '/tmp/debug.log'));

vi.mock('#services/pulse.ts', () => ({ flushPulse: flushPulseMock }));
vi.mock('#infra/utils/debug-log.ts', () => ({ writeDebugLog: writeDebugLogMock }));
vi.mock('#services/user-config.ts', () => ({ getUserConfig: () => ({}) }));

import { createColorManager } from './01-infrastructure/ui-core/color.ts';
import { createOutputManager } from './01-infrastructure/ui-core/output.ts';
import { BaseCommand } from './base-command.ts';
import { createCliDeps } from './deps.ts';

class TestCommand extends BaseCommand {
  async run(): Promise<void> {
    /* not used — catch() is driven directly */
  }
}

function makeCommand(jsonMode: boolean): TestCommand {
  const cmd = new TestCommand([], {} as Config);
  const color = createColorManager({ enabled: 'auto' });
  const out = createOutputManager({
    color,
    quiet: false,
    debug: false,
    jsonMode,
    plainMode: false,
  });
  (cmd as unknown as { deps: unknown }).deps = createCliDeps({
    color,
    out,
    config: {},
    flags: { quiet: false, debug: false, json: jsonMode, plain: false, noInput: true },
  });
  return cmd;
}

let stdoutWrites: string[];
let stderrWrites: string[];
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let prevExitCode: typeof process.exitCode;

beforeEach(() => {
  flushPulseMock.mockClear();
  writeDebugLogMock.mockClear();
  stdoutWrites = [];
  stderrWrites = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    stdoutWrites.push(String(chunk));
    return true;
  }) as never);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderrWrites.push(String(chunk));
    return true;
  }) as never);
  prevExitCode = process.exitCode;
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.exitCode = prevExitCode;
});

/** Drive catch() and swallow the terminal oclif ExitError it throws. */
async function runCatch(cmd: TestCommand, err: Error): Promise<void> {
  await expect(cmd.catch(err as Error & { exitCode?: number })).rejects.toThrow();
}

describe('BaseCommand.catch — --json output contract', () => {
  it('emits one-line JSON on stdout for a generic (non-CliError) error', async () => {
    const cmd = makeCommand(true);
    await runCatch(cmd, new Error('boom'));

    expect(stdoutWrites).toHaveLength(1);
    const parsed = JSON.parse(stdoutWrites[0]) as { error: string; code: number };
    expect(parsed.error).toBe('boom');
    expect(parsed.code).toBe(ExitCode.GENERAL_ERROR);
    expect(stderrWrites).toHaveLength(0);
  });

  it('emits one-line JSON on stdout for an oclif usage error', async () => {
    const cmd = makeCommand(true);
    const err = new Error('Nonexistent flag: --bogus') as Error & { oclif?: { exit: number } };
    err.oclif = { exit: 2 };
    await runCatch(cmd, err);

    expect(stdoutWrites).toHaveLength(1);
    const parsed = JSON.parse(stdoutWrites[0]) as { error: string; code: number };
    expect(parsed.error).toBe('Nonexistent flag: --bogus');
    expect(parsed.code).toBe(ExitCode.USAGE_ERROR);
    expect(stderrWrites).toHaveLength(0);
  });

  it('still renders the stderr card for generic errors without --json', async () => {
    const cmd = makeCommand(false);
    await runCatch(cmd, new Error('boom'));

    expect(stdoutWrites).toHaveLength(0);
    expect(stderrWrites.join('')).toContain('boom');
  });
});

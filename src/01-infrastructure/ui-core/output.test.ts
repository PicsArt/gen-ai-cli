/**
 * Output manager — result/info/error/debug routing + quiet/plain/JSON modes.
 * Migrated from `__tests__/unit/output-manager.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { createColorManager } from './color.ts';
import { createOutputManager } from './output.ts';

const color = createColorManager({ enabled: false });

function captureStreams(fn: () => void): { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { stdout, stderr };
}

describe('createOutputManager — stream routing', () => {
  it('result() writes to stdout, not stderr', () => {
    const out = createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });
    const { stdout, stderr } = captureStreams(() => out.result('hello'));
    expect(stdout).toContain('hello');
    expect(stderr).toBe('');
  });

  it('info() writes to stderr, not stdout', () => {
    const out = createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });
    const { stdout, stderr } = captureStreams(() => out.info('notice'));
    expect(stdout).toBe('');
    expect(stderr).toContain('notice');
  });
});

describe('createOutputManager — quiet mode', () => {
  it('suppresses info()', () => {
    const out = createOutputManager({ color, quiet: true, debug: false, jsonMode: false, plainMode: false });
    const { stderr } = captureStreams(() => out.info('notice'));
    expect(stderr).toBe('');
  });

  it('suppresses success()', () => {
    const out = createOutputManager({ color, quiet: true, debug: false, jsonMode: false, plainMode: false });
    const { stderr } = captureStreams(() => out.success('done'));
    expect(stderr).toBe('');
  });

  it('STILL emits error()', () => {
    const out = createOutputManager({ color, quiet: true, debug: false, jsonMode: false, plainMode: false });
    const { stderr } = captureStreams(() => out.error('fail'));
    expect(stderr).toContain('fail');
  });
});

describe('createOutputManager — debug mode', () => {
  it('debug() is hidden when debug=false', () => {
    const out = createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });
    const { stderr } = captureStreams(() => out.debug('dbg'));
    expect(stderr).toBe('');
  });

  it('debug() emits to stderr when debug=true', () => {
    const out = createOutputManager({ color, quiet: false, debug: true, jsonMode: false, plainMode: false });
    const { stderr } = captureStreams(() => out.debug('dbg'));
    expect(stderr).toContain('dbg');
  });
});

describe('createOutputManager — json()', () => {
  it('writes formatted JSON to stdout', () => {
    const out = createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });
    const { stdout } = captureStreams(() => out.json({ key: 'value' }));
    expect(stdout).toContain('"key"');
    expect(stdout).toContain('"value"');
  });
});

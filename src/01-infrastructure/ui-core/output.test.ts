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

function makeOut(opts: Partial<Parameters<typeof createOutputManager>[0]> = {}) {
  return createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false, ...opts });
}

describe('createOutputManager — table()', () => {
  const rows = [
    ['kling', 'video'],
    ['flux', 'image'],
  ];

  it('pads columns to align and bolds headers in formatted mode', () => {
    const out = makeOut();
    const { stdout } = captureStreams(() => out.table(rows, ['model', 'mode']));
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines[0]).toContain('model');
    expect(lines[1]).toMatch(/^-+\s+-+$/); // separator under headers
    expect(lines[2]).toContain('kling');
    // First column padded to equal width: 'kling' and 'flux ' both 5 chars
    expect(lines[2].indexOf('video')).toBe(lines[3].indexOf('image'));
  });

  it('emits tab-separated values in plain mode', () => {
    const out = makeOut({ plainMode: true });
    const { stdout } = captureStreams(() => out.table(rows, ['model', 'mode']));
    expect(stdout).toBe('model\tmode\nkling\tvideo\nflux\timage\n');
  });

  it('omits the header block when no headers are given', () => {
    const out = makeOut();
    const { stdout } = captureStreams(() => out.table(rows));
    expect(stdout.split('\n').filter(Boolean)).toHaveLength(2);
    expect(stdout).not.toContain('---');
  });

  it('tolerates ragged rows (fewer cells than the widest row)', () => {
    const out = makeOut();
    const { stdout } = captureStreams(() => out.table([['a', 'b', 'c'], ['only-one']]));
    expect(stdout).toContain('only-one');
  });
});

describe('createOutputManager — kvPairs()', () => {
  it('aligns values by padding keys to the widest key', () => {
    const out = makeOut();
    const { stdout } = captureStreams(() =>
      out.kvPairs([
        ['ID', 'kling-v3'],
        ['Provider', 'kling'],
      ]),
    );
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines[0].indexOf('kling-v3')).toBe(lines[1].indexOf('kling'));
  });
});

describe('createOutputManager — card() and divider()', () => {
  it('card() renders to stderr', () => {
    const out = makeOut();
    const { stdout, stderr } = captureStreams(() => out.card(['inside'], { title: 'Box' }));
    expect(stderr).toContain('inside');
    expect(stderr).toContain('Box');
    expect(stdout).toBe('');
  });

  it('divider() renders to stderr with an optional label', () => {
    const out = makeOut();
    const { stderr } = captureStreams(() => out.divider({ label: 'Section' }));
    expect(stderr).toContain('Section');
  });
});

describe('createOutputManager — richTable()', () => {
  it('renders rows using column definitions to stdout', () => {
    const out = makeOut();
    const { stdout } = captureStreams(() =>
      out.richTable([{ id: 'kling', mode: 'video' }], {
        columns: [{ key: 'id' }, { key: 'mode', label: 'Mode' }],
      }),
    );
    expect(stdout).toContain('kling');
    expect(stdout).toContain('Mode');
  });
});

describe('getOutput — lazy self-initialization', () => {
  it('returns a working manager even when no command primed the singleton', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    const fresh = await import('./output.ts');
    // Regression: this used to throw "OutputManager has not been initialized",
    // crashing any service that logged before BaseCommand.init() ran.
    const out = fresh.getOutput();
    const { stderr } = captureStreams(() => out.info('early message'));
    expect(stderr).toContain('early message');
  });
});

describe('isQuietMode', () => {
  it('reflects the quiet flag of the last created manager', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    const fresh = await import('./output.ts');
    expect(fresh.isQuietMode()).toBe(false); // default before any init
    fresh.createOutputManager({ color, quiet: true, debug: false, jsonMode: false, plainMode: false });
    expect(fresh.isQuietMode()).toBe(true);
    fresh.createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });
    expect(fresh.isQuietMode()).toBe(false);
  });
});

describe('createOutputManager — piped stdout keeps data clean', () => {
  function withStdoutTty(isTTY: boolean, fn: () => void): void {
    const saved = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
    try {
      fn();
    } finally {
      if (saved) Object.defineProperty(process.stdout, 'isTTY', saved);
      else Reflect.deleteProperty(process.stdout, 'isTTY');
    }
  }

  const enabledColor = createColorManager({ enabled: true });

  it('strips ANSI from table output when stdout is not a TTY', () => {
    const out = createOutputManager({
      color: enabledColor,
      quiet: false,
      debug: false,
      jsonMode: false,
      plainMode: false,
    });
    withStdoutTty(false, () => {
      const { stdout } = captureStreams(() => out.table([['a', 'b']], ['H1', 'H2']));
      expect(stdout).not.toContain('\x1b[');
      expect(stdout).toContain('H1');
    });
  });

  it('keeps ANSI in table output when stdout is a TTY', () => {
    const out = createOutputManager({
      color: enabledColor,
      quiet: false,
      debug: false,
      jsonMode: false,
      plainMode: false,
    });
    withStdoutTty(true, () => {
      const { stdout } = captureStreams(() => out.table([['a', 'b']], ['H1', 'H2']));
      expect(stdout).toContain('\x1b[');
    });
  });

  it('strips ANSI from kvPairs and richTable when stdout is piped', () => {
    const out = createOutputManager({
      color: enabledColor,
      quiet: false,
      debug: false,
      jsonMode: false,
      plainMode: false,
    });
    withStdoutTty(false, () => {
      const kv = captureStreams(() => out.kvPairs([['Key', 'Value']]));
      expect(kv.stdout).not.toContain('\x1b[');
      const rt = captureStreams(() => out.richTable([{ a: 'x' }], { columns: [{ key: 'a' }] }));
      expect(rt.stdout).not.toContain('\x1b[');
    });
  });

  it('result() passes data through raw even when stdout is piped', () => {
    const out = createOutputManager({
      color: enabledColor,
      quiet: false,
      debug: false,
      jsonMode: false,
      plainMode: false,
    });
    const data = 'raw \x1b[31mdata\x1b[0m';
    withStdoutTty(false, () => {
      const { stdout } = captureStreams(() => out.result(data));
      expect(stdout).toContain(data);
    });
  });
});

describe('createOutputManager — untrusted-string scrubbing', () => {
  const out = () => createOutputManager({ color, quiet: false, debug: false, jsonMode: false, plainMode: false });

  it('scrubs raw control bytes from info()/error() messages', () => {
    const { stderr } = captureStreams(() => out().info('name\x1b]0;spoof\x07end'));
    expect(stderr).not.toContain('\x1b]');
    expect(stderr).not.toContain('\x07');
    expect(stderr).toContain('end');
  });

  it('scrubs control bytes from card titles and lines', () => {
    const { stderr } = captureStreams(() => out().card(['line\x1b[2Jtext'], { title: 'T\x9bK' }));
    expect(stderr).not.toContain('\x1b[2J');
    expect(stderr).not.toContain('\x9b');
    expect(stderr).toContain('TK');
  });

  it('scrubs control bytes from table cells', () => {
    const { stdout } = captureStreams(() => out().table([['a\x07b']], ['H']));
    expect(stdout).not.toContain('\x07');
    expect(stdout).toContain('ab');
  });
});

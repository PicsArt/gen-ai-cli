/**
 * Card-based help renderer — command resolution, flag/usage/example cards,
 * and the flag-default regression (function/object defaults must not be
 * rendered as source code). The command manifest is injected by the caller
 * (layer-1 must not import the layer-5 command tree), so the test passes a
 * plain fake object.
 */
import { describe, expect, it } from 'vitest';
import { showCardHelp } from './custom-help.ts';

const FAKE_COMMANDS: Record<string, unknown> = {
  generate: {
    summary: 'Generate media from a prompt',
    description: 'Generate media from a prompt\nLong-form body line.',
    flags: {
      prompt: { char: 'p', description: 'Generation prompt' },
      ratio: {
        description: 'Aspect ratio',
        options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '2:1', '1:2'],
        default: '16:9',
      },
      download: { description: 'Download directory', default: () => './output' },
      secret: { hidden: true, description: 'Internal flag' },
    },
    args: {
      prompt: { required: true },
      extra: { required: false },
    },
    examples: [
      '<%= config.bin %> generate -p "a cat"',
      { command: '<%= config.bin %> generate -p "a dog"', description: 'Generate a dog' },
    ],
  },
  'models:info': {
    summary: 'Show model info',
    flags: {},
  },
};

function captureStdout(fn: () => void): string {
  let output = '';
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return output;
}

describe('showCardHelp', () => {
  it('returns false for an unknown command', () => {
    const output = captureStdout(() => {
      expect(showCardHelp('does-not-exist', FAKE_COMMANDS)).toBe(false);
    });
    expect(output).toBe('');
  });

  it('renders summary, usage, flags, and examples for a known command', () => {
    let found = false;
    const output = captureStdout(() => {
      found = showCardHelp('generate', FAKE_COMMANDS);
    });
    expect(found).toBe(true);
    expect(output).toContain('Generate media from a prompt');
    expect(output).toContain('$ gen-ai generate PROMPT [EXTRA]');
    expect(output).toContain('--prompt');
    expect(output).toContain('-p');
    expect(output).toContain('gen-ai generate -p "a cat"'); // <%= config.bin %> replaced
    expect(output).toContain('Generate a dog');
  });

  it('resolves space-separated topics to colon-separated command keys', () => {
    const output = captureStdout(() => {
      expect(showCardHelp('models info', FAKE_COMMANDS)).toBe(true);
    });
    expect(output).toContain('Show model info');
  });

  it('hides hidden flags', () => {
    const output = captureStdout(() => showCardHelp('generate', FAKE_COMMANDS));
    expect(output).not.toContain('--secret');
  });

  it('truncates long enum option lists with an "(and N more)" tail', () => {
    const output = captureStdout(() => showCardHelp('generate', FAKE_COMMANDS));
    expect(output).toContain('options: 16:9');
    expect(output).toContain('(and 2 more)');
  });

  it('prints primitive flag defaults', () => {
    const output = captureStdout(() => showCardHelp('generate', FAKE_COMMANDS));
    expect(output).toContain('default: 16:9');
  });

  it('does NOT print function defaults as source code', () => {
    const output = captureStdout(() => showCardHelp('generate', FAKE_COMMANDS));
    expect(output).not.toContain('=>');
    expect(output).not.toContain('[object');
  });
});

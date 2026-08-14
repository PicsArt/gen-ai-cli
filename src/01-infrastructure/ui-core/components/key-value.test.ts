import { describe, expect, it } from 'vitest';
import { createColorManager } from '../color.ts';
import { renderKeyValue } from './key-value.ts';

const color = createColorManager({ enabled: false });

describe('renderKeyValue', () => {
  const pairs: [string, string][] = [
    ['Model', 'Flux 2 Pro'],
    ['Provider', 'Flux'],
    ['Cost', '8 credits'],
  ];

  it('renders every key and value', () => {
    const result = renderKeyValue(pairs, { color });
    expect(result).toContain('Model');
    expect(result).toContain('Flux 2 Pro');
    expect(result).toContain('Provider');
    expect(result).toContain('Flux');
    expect(result).toContain('Cost');
    expect(result).toContain('8 credits');
  });

  it('aligns values to the longest key', () => {
    const result = renderKeyValue(pairs, { color });
    const lines = result.split('\n');
    // longest key "Provider" = 8 chars; indent=2, gap=4 → value starts at col 14
    const expectedValueStart = 2 + 8 + 4;
    for (const line of lines) {
      const value = pairs.find(([, v]) => line.includes(v))?.[1];
      if (value) expect(line.indexOf(value)).toBe(expectedValueStart);
    }
  });

  it('respects indent option', () => {
    const flat: [string, string][] = [['Key', 'Value']];
    expect(renderKeyValue(flat, { color, indent: 4 }).startsWith('    ')).toBe(true);
    const tight = renderKeyValue(flat, { color, indent: 0 });
    expect(tight.startsWith(' ')).toBe(false);
    expect(tight.startsWith('Key')).toBe(true);
  });

  it('returns empty string for empty pairs', () => {
    expect(renderKeyValue([], { color })).toBe('');
  });

  it('word-wraps long values and aligns continuation lines under the value column', () => {
    const longValue = 'one two three four five six seven eight nine ten eleven twelve';
    const result = renderKeyValue([['Key', longValue]], { color, maxWidth: 40 });
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    // Continuation lines start at the same column as the first value chunk
    const valueStart = lines[0].indexOf('one');
    expect(lines[1].search(/\S/)).toBe(valueStart);
    // Re-joined text preserves every word
    const rejoined = lines.map((l) => l.trim()).join(' ');
    expect(rejoined).toContain('twelve');
  });

  it('does not wrap when maxWidth is generous', () => {
    const result = renderKeyValue([['Key', 'short value']], { color, maxWidth: 200 });
    expect(result.split('\n')).toHaveLength(1);
  });
});
